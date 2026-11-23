/* Monsieur Flop : application du jeu.
   Une page unique, sans étape de compilation. Les données viennent des routes /api/jeu/*. */
(function () {
  "use strict";

  const pb = new PocketBase(window.location.origin);
  pb.autoCancellation(false);
  const JEU = window.JEU || {};
  JEU.nom = JEU.nom || "Monsieur Flop";
  JEU.sousTitre = JEU.sousTitre || "";
  JEU.calendrier = JEU.calendrier || [];
  JEU.jalons = JEU.jalons || [];
  JEU.grades = JEU.grades && JEU.grades.length ? JEU.grades : [["Militant de base", 0, "📣"]];
  const app = document.getElementById("app");
  const nav = document.getElementById("nav");

  const S = {
    etat: null, etatLe: 0,
    classement: null, classementLe: 0,
    saisie: {}, filtres: {},
    edition: null, resolution: {},
    ecart: 0, derniereRoute: "",
    jetonRoute: 0, tableau: null, tableauFrais: false, rapportCandidats: null, rapportCotes: null, rapportImport: null, filtreTableau: "", calendrier: null,
  };

  const PHASES = { campagne: "Campagne", parrainages: "Parrainages", premier_tour: "1er tour", second_tour: "2nd tour" };
  const TYPES = { choix: "Un seul choix", oui_non: "Oui ou non", classement: "Classement", estimation: "Estimation", scores: "Scores", vote: "Mon vote" };
  const STATUTS_CANDIDAT = { declare: "Déclaré", pressenti: "Pressenti", officiel: "Sur la liste officielle", non_retenu: "Non retenu", retire: "Retiré" };
  // Liens possibles entre un pari et le tableau des candidats. Doit rester égal à LIENS dans pb_hooks/jeu_lib.js.
  const LIENS = {
    parrainages: ["Les 500 signatures", "oui_non"],
    nb_officiels: ["Le nombre de candidats officiels", "estimation"],
    en_tete_t1: ["Le premier du 1er tour", "choix"],
    podium_t1: ["Le podium du 1er tour", "classement"],
    flop_t1: ["Le flop 3 du 1er tour", "classement"],
    boulet_t1: ["Le pire score du 1er tour", "choix"],
    scores_t1: ["Les scores du 1er tour", "scores"],
    abstention_t1: ["L’abstention au 1er tour", "estimation"],
    participation_t1: ["La participation au 1er tour", "estimation"],
    blanc_t1: ["Le vote blanc au 1er tour", "estimation"],
    vote_t1: ["Mon vote au 1er tour", "vote"],
    elu: ["L’élu au 2nd tour", "choix"],
    score_vainqueur_t2: ["Le score de l’élu", "estimation"],
    scores_t2: ["Les scores du 2nd tour", "scores"],
    abstention_t2: ["L’abstention au 2nd tour", "estimation"],
    blanc_t2: ["Le vote blanc au 2nd tour", "estimation"],
    vote_t2: ["Mon vote au 2nd tour", "vote"],
  };
  // Bords politiques, pour les sons. Doit rester égal à BORDS dans pb_hooks/jeu_lib.js.
  const BORDS = { extreme_gauche: "Extrême gauche", gauche: "Gauche", ecolo: "Écologiste", centre: "Centre", droite: "Droite", extreme_droite: "Extrême droite", autre: "Autre" };
  const BONUS_DUEL = 20;
  const COULEURS_COURBES = ["#3A6FB0", "#2E8B8B", "#C9930F", "#7A4FA3", "#5E8C3A"];

  const ICONES = {
    retour: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01" stroke-linecap="round"/></svg>',
    suite: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    calendrier: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke-linecap="round"/></svg>',
    croix: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>',
    medaille: '<svg viewBox="0 0 48 48" aria-hidden="true"><path class="RUBAN" d="M15 3h7l4 13h-7zM33 3h-7l-4 13h7z"/><circle class="MEDAILLE" cx="24" cy="30" r="13"/><path class="RUBAN" d="M24 23.5l2 4.2 4.6.5-3.4 3.1 1 4.5-4.2-2.4-4.2 2.4 1-4.5-3.4-3.1 4.6-.5z"/></svg>',
  };

  // ======================================================================
  // Outils
  // ======================================================================

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      // Espaces insécables de la typographie française : jamais de « ? » seul en début de ligne.
      .replace(/ ([?!:;»])/g, "\u202F$1").replace(/« /g, "«\u202F")
      .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }
  function dms(s) {
    if (!s) return 0;
    const t = Date.parse(String(s).replace(" ", "T"));
    return isNaN(t) ? 0 : t;
  }
  // Dates du fichier config.js : « 2027-03-12 » ou « 2027-04-18T20:00 », en heure locale.
  function dateConfig(s) {
    if (!s) return 0;
    return new Date(s.length === 10 ? s + "T00:00" : s).getTime();
  }
  function maintenant() { return Date.now() + S.ecart; }
  const fmtJour = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
  const fmtCourt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" });
  const fmtHeure = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
  const fmtNb = new Intl.NumberFormat("fr-FR");
  function jour(ms) { return fmtJour.format(new Date(ms)); }
  function court(ms) { return fmtCourt.format(new Date(ms)); }
  function heure(ms) { return fmtHeure.format(new Date(ms)).replace(":", "\u00A0h\u00A0").replace(/ (\d{1,2})\u00A0h/, "\u00A0$1\u00A0h"); }
  function nb(n) { return fmtNb.format(n); }
  function pctTxt(p) { return String(p).replace(".", ",") + "\u202F%"; }
  function pluriel(n, mot, motPluriel) { return nb(n) + " " + (Math.abs(n) > 1 ? (motPluriel || mot + "s") : mot); }
  function dans(iso) {
    const d = dms(iso) - maintenant();
    const abs = Math.abs(d);
    let t;
    if (abs < 3600000) t = Math.max(1, Math.round(abs / 60000)) + " min";
    else if (abs < 48 * 3600000) t = Math.round(abs / 3600000) + " h";
    else t = Math.round(abs / 86400000) + " jours";
    return d >= 0 ? "dans " + t : "il y a " + t;
  }
  // Cette valeur doit rester égale à PLAFOND_POINTS dans pb_hooks/jeu_lib.js.
  const PLAFOND_POINTS = 300;
  function pointsProba(pct) {
    const p = Math.min(99, Math.max(1, Number(pct) || 50));
    return Math.min(PLAFOND_POINTS, Math.round(1000 / p));
  }
  function avecCoef(pari, base) { return Math.round(base * (Number(pari.coef) || 1)); }
  function coefTxt(c) { return "×" + String(c).replace(".", ","); }
  function parId(liste) {
    const o = {};
    (liste || []).forEach((x) => { o[x.id] = x; });
    return o;
  }
  function copie(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function memeReponse(a, b) {
    const s = (v) => {
      if (Array.isArray(v)) return "[" + v.map(s).join(",") + "]";
      if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => k + ":" + s(v[k])).join(",") + "}";
      return JSON.stringify(v === undefined ? null : v);
    };
    return s(a) === s(b);
  }

  async function api(chemin, opts) {
    opts = opts || {};
    try {
      return await pb.send(chemin, { method: opts.method || "GET", body: opts.body });
    } catch (err) {
      if (err && err.status === 401) {
        pb.authStore.clear();
        location.hash = "#/connexion";
      }
      const msg = (err && err.response && err.response.message) || (err && err.message) || "Le serveur ne répond pas.";
      throw new Error(msg === "Too Many Requests." ? "Trop de tentatives : patiente une minute avant de réessayer." : msg);
    }
  }

  async function chargerEtat(force) {
    if (!force && S.etat && Date.now() - S.etatLe < 15000) return S.etat;
    const e = await api("/api/jeu/etat");
    S.ecart = dms(e.serveur) - Date.now();
    S.etat = e;
    S.etatLe = Date.now();
    return e;
  }
  async function chargerClassement(force) {
    if (!force && S.classement && Date.now() - S.classementLe < 15000) return S.classement;
    S.classement = await api("/api/jeu/classement");
    S.classementLe = Date.now();
    return S.classement;
  }
  function invalider() { S.etatLe = 0; S.classementLe = 0; }
  function aller(hash) {
    if (location.hash === hash) router();
    else location.hash = hash;
  }

  let minuterieToast = null;
  function notifier(message, erreur) {
    const t = document.getElementById("toast");
    t.textContent = message;
    t.className = "toast visible" + (erreur ? " erreur" : "");
    clearTimeout(minuterieToast);
    minuterieToast = setTimeout(() => { t.className = "toast" + (erreur ? " erreur" : ""); }, erreur ? 5000 : 2800);
  }
  function coupDeTampon() {
    const t = document.getElementById("tampon");
    t.classList.remove("actif");
    void t.offsetWidth;
    t.classList.add("actif");
    setTimeout(() => t.classList.remove("actif"), 1200);
  }

  // ======================================================================
  // Volumes : deux réglages, musique et bruitages, de 0 à 100.
  // Ouverts par le bouton de l'en-tête, mémorisés dans le navigateur de chaque joueur.
  // ======================================================================

  const Volumes = (function () {
    const lire = (cle, defaut) => {
      try {
        const v = localStorage.getItem(cle);
        if (v !== null && isFinite(Number(v))) return Math.max(0, Math.min(100, Number(v)));
      } catch (err) { /* stockage indisponible */ }
      return defaut;
    };
    // Musique à 25 par défaut : présente mais discrète. Un joueur qui l'avait coupée avec l'ancien bouton la garde coupée.
    let musiqueCoupee = false;
    try { musiqueCoupee = localStorage.getItem("flop-musique") === "0"; } catch (err) { /* rien */ }
    const v = { musique: lire("flop-volume-musique", musiqueCoupee ? 0 : 25), bruitages: lire("flop-volume-bruitages", 70) };
    return {
      get musique() { return v.musique; },
      get bruitages() { return v.bruitages; },
      regler(cle, valeur) {
        v[cle] = Math.max(0, Math.min(100, Number(valeur) || 0));
        try { localStorage.setItem("flop-volume-" + cle, String(v[cle])); } catch (err) { /* rien */ }
      },
    };
  })();

  // ======================================================================
  // Bruitages fabriqués dans le navigateur
  // ======================================================================

  const Son = (function () {
    let ctx = null;
    let sortie = null;
    function pret() {
      if (!Volumes.bruitages) return null;
      // Pas de son tant que la personne n'a pas encore interagi avec la page.
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        ctx = new C();
        sortie = ctx.createGain();
        sortie.connect(ctx.destination);
      }
      sortie.gain.value = 0.7 * (Volumes.bruitages / 100);
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return ctx;
    }
    function note(f, debut, duree, type, vol, glisse) {
      const c = pret();
      if (!c) return;
      const t = c.currentTime + debut;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(f, t);
      if (glisse) o.frequency.exponentialRampToValueAtTime(glisse, t + duree);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.25, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
      o.connect(g).connect(sortie);
      o.start(t);
      o.stop(t + duree + 0.05);
    }
    function souffle(duree, vol, freq) {
      const c = pret();
      if (!c) return;
      const buf = c.createBuffer(1, Math.floor(c.sampleRate * duree), c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = freq;
      const g = c.createGain();
      g.gain.value = vol;
      src.connect(f).connect(g).connect(sortie);
      src.start();
    }
    return {
      clic() { note(900, 0, 0.05, "triangle", 0.12); },
      pop() { note(480, 0, 0.09, "sine", 0.32, 1150); },
      refus() { note(220, 0, 0.15, "square", 0.07); },
      tampon() { souffle(0.16, 0.8, 220); note(120, 0, 0.18, "sine", 0.45, 55); },
      piece() { [1046.5, 1318.5, 1568, 2093].forEach((f, i) => note(f, 0.15 + i * 0.065, 0.2, "triangle", 0.18)); },
      tic() { note(1500 + Math.random() * 300, 0, 0.03, "square", 0.03); },
      carillon() { [1318.5, 1760, 2637].forEach((f, i) => note(f, i * 0.09, 0.6, "sine", 0.11)); },
      fanfare() {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, i * 0.11, i === 3 ? 0.55 : 0.15, "square", 0.08));
        for (let i = 0; i < 8; i++) note(1800 + Math.random() * 1600, 0.45 + i * 0.04, 0.14, "sine", 0.05);
      },
      rate() { [311, 294, 277, 262].forEach((f, i) => note(f, i * 0.36, i === 3 ? 0.9 : 0.32, "sawtooth", 0.08)); },
    };
  })();

  // ======================================================================
  // Sons et musique déposés dans perso/ (liste fournie par /api/jeu/sons)
  // ======================================================================

  const Banque = { bords: {}, valider: [], musique: null };
  let clipEnCours = null;
  // Renvoie true si le son est pris en charge (joué, ou bruitages coupés).
  function jouerFichier(url) {
    try {
      if (!Volumes.bruitages) return true;
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
      if (clipEnCours) clipEnCours.pause();
      const a = new Audio(encodeURI(url));
      a.volume = Volumes.bruitages / 100;
      clipEnCours = a;
      const lecture = a.play();
      if (lecture) lecture.catch(() => {});
      return true;
    } catch (err) {
      return false;
    }
  }
  function auHasard(liste) { return liste[Math.floor(Math.random() * liste.length)]; }
  // Un son du bord politique du candidat, sinon le petit « pop ».
  function sonCandidat(id) {
    const c = S.etat ? (S.etat.candidats || []).find((x) => x.id === id) : null;
    const liste = c && c.bord ? Banque.bords[c.bord] || [] : [];
    if (liste.length && jouerFichier(auHasard(liste))) return;
    Son.pop();
  }
  function sonValider() {
    if (Banque.valider.length && jouerFichier(auHasard(Banque.valider))) return;
    Son.tampon();
    Son.piece();
  }

  // Musique de fond, au volume réglé par le joueur (25 par défaut, discret).
  const Musique = (function () {
    let audio = null;
    function appliquer() {
      const v = Volumes.musique;
      if (!Banque.musique) return;
      if (!v) { if (audio) audio.pause(); return; }
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
      if (!audio) {
        audio = new Audio(encodeURI(Banque.musique));
        audio.loop = true;
      }
      // Courbe douce : les petits réglages restent discrets.
      audio.volume = Math.pow(v / 100, 2);
      if (audio.paused) {
        const lecture = audio.play();
        if (lecture) lecture.catch(() => {});
      }
    }
    return { appliquer: appliquer };
  })();

  async function chargerSons() {
    try {
      const r = await api("/api/jeu/sons");
      Banque.bords = r.bords || {};
      Banque.valider = r.valider || [];
      Banque.musique = r.musique || null;
    } catch (err) { /* sans sons : les bruitages du navigateur prennent le relais */ }
    majBoutonSon();
    Musique.appliquer();
  }

  const mouvementReduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function confettis(n) {
    if (mouvementReduit) return;
    const couleurs = ["#FF6FB5", "#2D4FA8", "#F5D65B", "#2FB98A", "#E1352E", "#B58CFF"];
    for (let i = 0; i < (n || 70); i++) {
      const el = document.createElement("div");
      el.className = "confetti";
      el.style.left = Math.random() * 100 + "vw";
      el.style.background = couleurs[i % couleurs.length];
      el.style.setProperty("--x", (Math.random() * 200 - 100) + "px");
      el.style.setProperty("--r", (Math.random() * 1080 - 540) + "deg");
      el.style.setProperty("--d", (1.8 + Math.random() * 1.5) + "s");
      el.style.animationDelay = Math.random() * 0.25 + "s";
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 3800);
    }
  }

  // Petite mémoire locale par joueur : dernier grade vu, derniers points vus, résultats déjà fêtés.
  function memoire(cle, valeur) {
    const id = pb.authStore.record ? pb.authStore.record.id : "anonyme";
    const k = "flop-" + cle + "-" + id;
    try {
      if (valeur === undefined) return JSON.parse(localStorage.getItem(k));
      localStorage.setItem(k, JSON.stringify(valeur));
    } catch (err) { return null; }
    return valeur;
  }

  function gradeDe(points) {
    let n = 0;
    JEU.grades.forEach((g, i) => { if (points >= g[1]) n = i; });
    return n;
  }

  function ouvrirPromotion(grade) {
    document.getElementById("promo-icone").textContent = grade[2];
    document.getElementById("promo-texte").textContent = "Tu deviens " + grade[0] + ". Tes amis vont devoir t’appeler autrement.";
    document.getElementById("promo").classList.add("visible");
    document.getElementById("promo-ok").focus();
    Son.fanfare();
    confettis();
  }

  function rendre(html) {
    const actif = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.cle : null;
    app.innerHTML = html;
    appliquerFiltres();
    app.querySelectorAll("img[data-affiche]").forEach((img) => {
      img.addEventListener("error", () => img.closest(".affiche").remove());
    });
    if (actif) {
      const el = app.querySelector('[data-cle="' + CSS.escape(actif) + '"]');
      if (el) el.focus({ preventScroll: true });
    }
  }

  function badgeGuilde(gid) {
    const g = S.etat ? parId(S.etat.guildes)[gid] : null;
    if (!g) return "";
    return '<span class="guilde" style="--c:' + esc(g.couleur) + '"><i></i>' + esc(g.nom) + "</span>";
  }
  function partiDe(id) {
    const c = S.etat ? parId(S.etat.candidats)[id] : null;
    return c ? c.parti : "";
  }
  function libelle(pari, id) {
    const o = (pari.options || []).find((x) => x.id === id);
    return o ? o.label : "réponse retirée";
  }
  function puceEtat(p) {
    const txt = {
      brouillon: "Brouillon",
      a_venir: "Ouvre le " + court(dms(p.ouverture)),
      ouvert: "Ouvert",
      clos: "Clos",
      resolu: "Résultat connu",
    }[p.etat];
    return '<span class="puce puce-' + (p.etat === "a_venir" ? "clos" : p.etat) + '">' + esc(txt) + "</span>";
  }
  function puceCoef(p) {
    return Number(p.coef) !== 1 ? '<span class="puce puce-coef" title="Les points de ce pari sont multipliés par ' + esc(String(p.coef).replace(".", ",")) + '">' + coefTxt(p.coef) + "</span>" : "";
  }

  // ======================================================================
  // Navigation
  // ======================================================================

  function majNav(hash) {
    const cle = hash.indexOf("#/pari") === 0 ? "paris" : hash.indexOf("#/admin") === 0 ? "profil" : (hash.split("/")[1] || "paris");
    nav.querySelectorAll("a[data-nav]").forEach((a) => {
      if (a.dataset.nav === cle) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  async function router() {
    const hash = location.hash || "#/paris";
    const connecte = pb.authStore.isValid && pb.authStore.record;
    nav.hidden = !connecte;
    majNav(hash);
    if (hash !== S.derniereRoute) window.scrollTo(0, 0);
    app.classList.toggle("large", hash === "#/admin/candidats");
    S.derniereRoute = hash;
    S.jetonRoute++;
    let m;
    try {
      if (!connecte) {
        if ((m = hash.match(/^#\/inscription(?:\/([A-Za-z0-9]+))?/))) return await vueInscription(m[1] || "");
        if (hash.indexOf("#/regles") === 0) return vueRegles(hash);
        return await vueConnexion();
      }
      if (hash === "#/" || hash === "#/paris" || hash === "#" || hash.indexOf("#/connexion") === 0 || hash.indexOf("#/inscription") === 0) {
        if (hash !== "#/paris") history.replaceState(null, "", "#/paris");
        return await vueParis();
      }
      if ((m = hash.match(/^#\/pari\/([A-Za-z0-9_]+)$/))) return await vuePari(m[1]);
      if ((m = hash.match(/^#\/classement(?:\/([a-z]+))?$/))) return await vueClassement(m[1] || "joueurs");
      if (hash === "#/calendrier") return await vueCalendrier();
      if (hash.indexOf("#/regles") === 0) return vueRegles(hash);
      if (hash === "#/profil") return await vueProfil();
      if ((m = hash.match(/^#\/admin(?:\/([a-z]+))?(?:\/([A-Za-z0-9_]+))?$/))) return await vueAdmin(m[1] || "paris", m[2] || "");
      location.hash = "#/paris";
    } catch (err) {
      rendre('<div class="message message-erreur">' + esc(err.message) + '</div><p><a href="#/paris">Revenir aux paris</a></p>');
    }
  }

  // ======================================================================
  // Connexion et inscription
  // ======================================================================

  async function vueConnexion() {
    let premier = false;
    try { premier = (await api("/api/jeu/accueil")).premierCompte; } catch (err) { /* serveur injoignable : on affiche quand même le formulaire */ }
    rendre(
      '<div class="accueil-connexion">' + enteteAccueil() +
      '<p class="discret" style="text-align:center;margin:1rem auto">Le jeu de pronostics entre amis sur la présidentielle 2027.</p>' +
      (premier ? '<div class="message message-info">Aucun compte n’existe encore. <a href="#/inscription">Crée le premier compte</a> : il sera administrateur du jeu.</div>' : "") +
      '<form class="carte" data-form="connexion" novalidate>' +
      '<label class="champ"><span>Email</span><input type="email" name="email" autocomplete="username" required></label>' +
      '<label class="champ"><span>Mot de passe</span><input type="password" name="mdp" autocomplete="current-password" required></label>' +
      '<div class="erreur-form" aria-live="polite"></div>' +
      '<button class="bouton bouton-large" type="submit">Se connecter</button>' +
      "</form>" +
      '<p style="margin-top:1.5rem">Pas encore de compte ? <a href="#/inscription">Créer un compte avec un code d’invitation</a></p>' +
      '<p><a href="#/regles">Lire les règles du jeu</a></p>' +
      '<p class="petit discret">Mot de passe oublié : demande à l’admin du jeu de le réinitialiser.</p>' +
      "</div>"
    );
  }

  async function vueInscription(code) {
    const acc = await api("/api/jeu/accueil");
    S.inscriptionGuilde = S.inscriptionGuilde || "";
    rendre(
      '<div class="accueil-connexion">' +
      "<h1>Rejoindre le jeu</h1>" +
      (acc.premierCompte
        ? '<div class="message message-info">Premier compte du jeu : tu en deviens l’admin. Aucun code n’est nécessaire.</div>'
        : '<p class="discret">Il te faut le code d’invitation envoyé par l’admin du jeu.</p>') +
      '<form class="carte" data-form="inscription" novalidate>' +
      (acc.premierCompte ? "" : '<label class="champ"><span>Code d’invitation</span><input type="text" name="code" value="' + esc(code) + '" autocomplete="off" autocapitalize="characters" required></label>') +
      '<label class="champ"><span>Pseudo</span><input type="text" name="pseudo" maxlength="30" autocomplete="nickname" required><small>C’est le nom que les autres joueurs verront.</small></label>' +
      '<label class="champ"><span>Email</span><input type="email" name="email" autocomplete="email" required><small>Sert seulement à te connecter.</small></label>' +
      '<label class="champ"><span>Mot de passe</span><input type="password" name="mdp" minlength="10" autocomplete="new-password" required><small>10 caractères minimum.</small></label>' +
      '<div class="champ"><span id="lbl-guilde">Ta guilde</span>' +
      '<div class="choix-guildes" role="radiogroup" aria-labelledby="lbl-guilde">' +
      acc.guildes.map((g) =>
        '<button type="button" class="choix-guilde" role="radio" aria-checked="' + (S.inscriptionGuilde === g.id) + '" data-action="choisir-guilde" data-id="' + esc(g.id) + '" data-cle="g-' + esc(g.id) + '" style="--c:' + esc(g.couleur) + '">' + esc(g.nom) + "</button>"
      ).join("") +
      "</div><small>Le choix est définitif. Le classement des guildes se fait sur la moyenne de leurs membres.</small></div>" +
      '<div class="erreur-form" aria-live="polite"></div>' +
      '<button class="bouton bouton-rouge bouton-large" type="submit">Créer mon compte</button>' +
      "</form>" +
      '<p style="margin-top:1.5rem"><a href="#/connexion">J’ai déjà un compte</a></p>' +
      "</div>"
    );
  }

  // ======================================================================
  // Accueil : la liste des paris
  // ======================================================================

  async function vueParis() {
    const res = await Promise.all([chargerEtat(), chargerClassement().catch(() => null)]);
    const e = res[0];
    const cl = res[1];
    const moiCl = cl ? cl.joueurs.find((j) => j.id === e.moi.id) : null;
    const groupes = { ouvert: [], a_venir: [], clos: [], resolu: [], brouillon: [] };
    e.paris.forEach((p) => groupes[p.etat].push(p));
    groupes.ouvert.sort((a, b) => dms(a.cloture) - dms(b.cloture));
    groupes.a_venir.sort((a, b) => dms(a.ouverture) - dms(b.ouverture));
    groupes.clos.sort((a, b) => dms(b.cloture) - dms(a.cloture));
    groupes.resolu.sort((a, b) => dms(b.resolu_le) - dms(a.resolu_le));
    const aFaire = groupes.ouvert.filter((p) => !p.monProno && p.type !== "vote");
    const nbPronos = e.paris.filter((p) => p.monProno).length;

    let html = enteteAccueil() + carteJoueur(e, cl, moiCl) + blocProchain(groupes.ouvert);

    if (!nbPronos) {
      html += '<div class="message message-info">Première visite ? <a href="#/regles">Les règles</a> expliquent comment les points sont calculés, et <a href="#/calendrier">le calendrier</a> montre quand chaque pari ouvre.</div>';
    }

    const section = (titre, liste, sousTitre) => {
      if (!liste.length) return "";
      return '<div class="section-titre"><h2>' + titre + "</h2>" + (sousTitre ? "<span>" + sousTitre + "</span>" : "") + "</div>" +
        '<ul class="liste-paris">' + liste.map(itemPari).join("") + "</ul>";
    };

    if (!groupes.ouvert.length && !groupes.a_venir.length && !groupes.clos.length && !groupes.resolu.length) {
      html += '<div class="vide"><p>Aucun pari n’est encore publié.</p><p><a href="#/calendrier">Voir le calendrier</a></p></div>';
    }
    html += section("Ouverts", groupes.ouvert, "Tu peux parier ou changer d’avis jusqu’à la clôture");
    html += section("Bientôt", groupes.a_venir);
    html += section("En attente du résultat", groupes.clos, "Les paris de tout le monde sont visibles");
    html += section("Terminés", groupes.resolu);
    if (groupes.brouillon.length) html += section("Brouillons", groupes.brouillon, "Visibles par l’admin seulement");
    html += '<div class="section-titre"><h2>Ta carrière politique</h2></div>' + echelleCarriere(moiCl ? moiCl.points : 0);
    if (cl) html += '<div class="section-titre"><h2>Tes trophées</h2><span>Provisoires jusqu’au second tour</span></div>' + grilleBadges(cl, e.moi.id);
    rendre(html);
    if (moiCl) celebrerProgression(moiCl.points);
  }

  // ---------- Éléments de l'accueil ----------

  function enteteAccueil() {
    return '<section class="accueil-flop">' +
      (JEU.affiche ? '<div class="affiche"><img data-affiche src="' + esc(JEU.affiche) + '" alt=""></div>' : "") +
      '<h1 class="titre-flop">' + esc(JEU.nom) + "</h1>" +
      (JEU.sousTitre ? '<p class="sous-titre-flop">' + esc(JEU.sousTitre) + "</p>" : "") +
      "</section>";
  }

  function initiales(pseudo) {
    const mots = String(pseudo || "?").trim().split(/\s+/);
    return (mots.length > 1 ? mots[0][0] + mots[1][0] : mots[0].slice(0, 2)).toUpperCase();
  }

  function carteJoueur(e, cl, moiCl) {
    const points = moiCl ? moiCl.points : 0;
    const n = gradeDe(points);
    const suivant = JEU.grades[n + 1];
    const pct = suivant ? Math.round(((points - JEU.grades[n][1]) / (suivant[1] - JEU.grades[n][1])) * 100) : 100;
    const g = parId(e.guildes)[e.moi.guilde] || {};
    return '<section class="carte joueur-flop" aria-label="Ta progression">' +
      '<div class="avatar-flop" style="--c:' + esc(g.couleur || "") + '" aria-hidden="true">' + esc(initiales(e.moi.pseudo)) + "</div>" +
      '<div><div class="grade">' + esc(e.moi.pseudo) + ", " + esc(JEU.grades[n][0]) +
      "<small>" + (suivant ? "Encore " + pluriel(suivant[1] - points, "point") + " pour devenir " + esc(suivant[0]) : "Sommet atteint : bienvenue à l’Élysée") + "</small></div>" +
      '<div class="jauge" role="progressbar" aria-label="Progression vers le grade suivant" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span style="width:' + pct + '%"></span></div>' +
      '<div class="petit discret" style="margin-top:.375rem">' + badgeGuilde(e.moi.guilde) + "</div></div>" +
      '<a class="points-flop" href="#/classement"><span id="mes-points">' + nb(points) + "</span><small>" +
      (moiCl ? (points > 1 ? "points" : "point") + ", " + moiCl.rang + (moiCl.rang === 1 ? "er" : "e") + " sur " + cl.joueurs.length : "points") + "</small></a>" +
      "</section>";
  }

  function blocProchain(ouverts) {
    const aFaire = ouverts.filter((p) => !p.monProno && p.type !== "vote");
    const p = aFaire[0] || ouverts[0];
    if (!p) return "";
    const attente = aFaire.length > 1 ? aFaire.length + " paris t’attendent. " : "";
    return '<section class="prochain" aria-label="Prochaine échéance"><div><b>' + esc(p.titre) + '</b><span class="detail">' + attente +
      (p.monProno ? "Tu as parié. Clôture le " : "Clôture le ") + esc(heure(dms(p.cloture))) + ".</span></div>" +
      '<div class="decompte" data-cible="' + esc(p.cloture) + '" aria-label="Temps restant">' + texteDecompte(p.cloture) + "</div>" +
      '<a class="bouton bouton-jaune" href="#/pari/' + esc(p.id) + '">' + (p.monProno ? "Voir mon pari" : "Je parie") + "</a></section>";
  }

  function texteDecompte(iso) {
    let s = Math.max(0, Math.floor((dms(iso) - maintenant()) / 1000));
    const j = Math.floor(s / 86400);
    s %= 86400;
    const h = Math.floor(s / 3600);
    s %= 3600;
    const m = Math.floor(s / 60);
    return [[j, j > 1 ? "jours" : "jour"], [h, "h"], [m, "min"]].map((x) => "<span>" + x[0] + "<small>" + x[1] + "</small></span>").join("");
  }

  function echelleCarriere(points) {
    const n = gradeDe(points);
    return '<ol class="carriere">' + JEU.grades.map((g, i) =>
      '<li class="' + (i < n ? "fait" : i === n ? "ici" : "") + '"' + (i === n ? ' aria-current="step"' : "") + '><i aria-hidden="true">' + esc(g[2]) + "</i>" + esc(g[0]) + "<br><small>" + nb(g[1]) + " pts</small></li>"
    ).join("") + "</ol>";
  }

  const ICONES_TROPHEES = { champion: "🏆", boulet: "🪨", decu: "😭", visionnaire: "🔮", sniper: "🎯", duelliste: "⚔️", kamikaze: "💣", girouette: "🌪️", mouton: "🐑", retardataire: "⏰" };
  function grilleBadges(cl, moiId) {
    return '<div class="badges">' + cl.trophees.map((t) => {
      const moi = t.gagnants.some((g) => g.id === moiId);
      return '<button type="button" class="badge' + (moi ? "" : " verrou") + '" data-action="badge" data-ok="' + moi + '">' +
        '<span class="medaille" aria-hidden="true">' + (ICONES_TROPHEES[t.cle] || "🏅") + "</span><b>" + esc(t.nom) + "</b><small>" +
        (moi ? "Tu es en tête" : t.gagnants.length ? "En tête : " + esc(t.gagnants.slice(0, 2).map((g) => g.pseudo).join(", ")) + (t.gagnants.length > 2 ? "…" : "") : "Pas encore attribué") +
        "</small></button>";
    }).join("") + "</div>";
  }

  // Points qui défilent, et promotion quand on change de grade depuis la dernière visite.
  function celebrerProgression(points) {
    const avant = memoire("points");
    const gradeAvant = memoire("grade");
    const gradeMaintenant = gradeDe(points);
    memoire("points", points);
    memoire("grade", gradeMaintenant);
    if (typeof avant === "number" && avant < points) {
      const el = document.getElementById("mes-points");
      const t0 = performance.now();
      let dernier = 0;
      Son.piece();
      const pas = (t) => {
        const p = Math.min(1, (t - t0) / 1100);
        if (el) el.textContent = nb(Math.round(avant + (points - avant) * (1 - Math.pow(1 - p, 3))));
        if (t - dernier > 70 && p < 1) { Son.tic(); dernier = t; }
        if (p < 1) requestAnimationFrame(pas);
      };
      requestAnimationFrame(pas);
    }
    if (typeof gradeAvant === "number" && gradeMaintenant > gradeAvant) {
      setTimeout(() => ouvrirPromotion(JEU.grades[gradeMaintenant]), 900);
    }
  }

  function itemPari(p) {
    const aFaire = p.etat === "ouvert" && !p.monProno && p.type !== "vote";
    let quand = "";
    if (p.etat === "ouvert") quand = "Ferme " + dans(p.cloture);
    else if (p.etat === "a_venir") quand = "Ouvre le " + jour(dms(p.ouverture));
    else if (p.etat === "clos") quand = "Fermé le " + court(dms(p.cloture));
    else if (p.etat === "resolu") quand = "Résultat le " + court(dms(p.resolu_le || p.cloture));
    else quand = "Brouillon";

    let perso = "";
    if (p.etat === "ouvert") perso = p.monProno ? '<span class="mini-tampon">Parié</span>' : (p.type === "vote" ? '<span class="discret petit">Facultatif</span>' : '<span class="a-faire-etiquette">À faire</span>');
    else if (p.etat === "clos") perso = p.monProno ? '<span class="mini-tampon">Parié</span>' : '<span class="discret petit">Pas parié</span>';
    else if (p.etat === "resolu") {
      if (p.type === "vote") perso = "";
      else perso = p.monProno ? '<span class="gain' + (p.monProno.points ? "" : " gain-nul") + '">+' + nb(p.monProno.points) + "</span>" : '<span class="discret petit">Pas parié</span>';
    }
    const lien = p.etat === "brouillon" ? "#/admin/pari/" + p.id : "#/pari/" + p.id;
    return '<li class="item-pari ' + p.etat + (aFaire ? " a-faire" : "") + '"><a href="' + lien + '">' +
      "<h3>" + esc(p.titre) + "</h3>" +
      '<div class="statut-perso">' + perso + "</div>" +
      '<div class="meta"><span>' + esc(PHASES[p.phase]) + "</span><span>" + esc(TYPES[p.type]) + "</span>" +
      (Number(p.coef) !== 1 ? "<span>" + coefTxt(p.coef) + "</span>" : "") + "<span>" + esc(quand) + "</span></div>" +
      "</a></li>";
  }

  // ======================================================================
  // Page d'un pari
  // ======================================================================

  function saisieInitiale(p) {
    if (p.monProno && p.monProno.reponse) return copie(p.monProno.reponse);
    return { choix: { option: null }, oui_non: { reponses: {} }, classement: { ordre: [] }, estimation: { valeur: "" }, scores: { valeurs: {} }, vote: { vais: "", voudrais: "" } }[p.type];
  }
  function saisieDe(p) {
    if (!S.saisie[p.id]) S.saisie[p.id] = saisieInitiale(p);
    return S.saisie[p.id];
  }
  function saisieComplete(p, s) {
    if (!s) return false;
    if (p.type === "choix") return !!s.option;
    if (p.type === "oui_non") return Object.keys(s.reponses || {}).length > 0;
    if (p.type === "classement") return (s.ordre || []).length === (Number(p.config.places) || 3);
    if (p.type === "estimation") return s.valeur !== "" && s.valeur !== null && isFinite(Number(String(s.valeur).replace(",", ".")));
    if (p.type === "vote") return !!(s.vais || s.voudrais);
    if (p.type === "scores") {
      const v = s.valeurs || {};
      return (p.options || []).length > 0 && (p.options || []).every((o) => v[o.id] !== "" && v[o.id] !== null && v[o.id] !== undefined && isFinite(Number(String(v[o.id]).replace(",", "."))));
    }
    return false;
  }

  async function vuePari(id) {
    const e = await chargerEtat();
    const p = e.paris.find((x) => x.id === id);
    if (!p) {
      rendre('<a class="retour" href="#/paris">' + ICONES.retour + 'Tous les paris</a><div class="vide"><p>Ce pari n’existe pas ou n’est pas encore publié.</p></div>');
      return;
    }
    let html = '<a class="retour" href="#/paris">' + ICONES.retour + "Tous les paris</a>";
    html += '<div class="entete-pari"><h1>' + esc(p.titre) + "</h1>" +
      '<div class="ligne">' + puceEtat(p) + '<span class="puce">' + esc(PHASES[p.phase]) + '</span><span class="puce">' + esc(TYPES[p.type]) + "</span>" + puceCoef(p) + "</div>" +
      '<p class="discret petit" style="margin-top:.75rem">' + texteCalendrierPari(p) + "</p>" +
      (p.description ? "<p>" + esc(p.description) + "</p>" : "") + "</div>";

    html += '<div class="calcul-ici">' + ICONES.info + "<p>" + explicationCourte(p) + ' <a href="#/regles/' + ancreType(p.type) + '">En savoir plus</a></p></div>';

    if (p.etat === "ouvert" || p.etat === "a_venir" || p.etat === "brouillon") {
      if (p.etat === "a_venir") html += '<div class="message message-info">Ce pari ouvre le ' + heure(dms(p.ouverture)) + ". En attendant, voici les réponses possibles et ce qu’elles rapportent.</div>";
      html += formulaire(p, saisieDe(p), p.etat !== "ouvert");
      if (p.etat === "ouvert") html += barreAction(p);
    } else {
      html += maReponse(p);
      html += devoilement(p);
    }
    if (p.type !== "vote" && p.etat !== "brouillon") html += sectionDuels(p, e);
    rendre(html);
    if (p.etat === "resolu" && p.monProno && p.type !== "vote") {
      const vus = memoire("resultats-vus") || [];
      if (vus.indexOf(p.id) < 0) {
        vus.push(p.id);
        memoire("resultats-vus", vus.slice(-200));
        if (p.monProno.points > 0) { Son.fanfare(); confettis(50); }
        else Son.rate();
      }
    }
  }

  function texteCalendrierPari(p) {
    if (p.etat === "ouvert") return "Clôture le " + heure(dms(p.cloture)) + ", " + dans(p.cloture) + ". " + pluriel(p.nbParieurs, "joueur a parié", "joueurs ont parié") + ".";
    if (p.etat === "a_venir") return "Ouverture le " + heure(dms(p.ouverture)) + ", clôture le " + heure(dms(p.cloture)) + ".";
    if (p.etat === "clos") return "Clos depuis le " + heure(dms(p.cloture)) + ". Le résultat sera saisi dès qu’il sera officiel.";
    if (p.etat === "resolu") return "Clos le " + heure(dms(p.cloture)) + ". Résultat saisi le " + jour(dms(p.resolu_le || p.cloture)) + ".";
    return "Brouillon : seul l’admin le voit.";
  }

  function ancreType(t) {
    return { choix: "choix", oui_non: "oui-non", classement: "classement", estimation: "estimation", scores: "scores", vote: "vote" }[t];
  }

  function explicationCourte(p) {
    const c = Number(p.coef) !== 1 ? " Les points de ce pari sont multipliés par " + String(p.coef).replace(".", ",") + "." : "";
    if (p.type === "choix") return "Une seule réponse. Si c’est la bonne, tu gagnes 10 ÷ sa probabilité : le gain est affiché sur chaque bulletin." + c;
    if (p.type === "oui_non") return "Oui ou non pour autant de noms que tu veux. Chaque bonne réponse rapporte 10 ÷ la probabilité de ta réponse, une mauvaise ne coûte rien. La probabilité affichée est celle du oui." + c;
    if (p.type === "classement") return "Place les noms dans l’ordre. À la bonne place : 10 ÷ probabilité. Dans le classement mais mal placé : la moitié." + c;
    if (p.type === "estimation") {
      const pente = Number(p.config.pente) || 10;
      return "Donne un nombre. Tu pars de 100 points et tu en perds " + String(pente).replace(".", ",") + " par " + esc(p.config.unite === "%" ? "point de pourcentage" : "unité") + " d’écart avec le vrai résultat, sans descendre sous 0." + c;
    }
    if (p.type === "scores") {
      const pente = Number(p.config.pente) || 10;
      return "Donne le score de chaque candidat, en %. Pour chacun, tu pars de 100 points et tu en perds " + String(pente).replace(".", ",") + " par point d’écart avec son vrai score. Tu gagnes la moyenne : au plus 100 points." + c;
    }
    return "Facultatif, sans points. Tes réponses ne sont dévoilées qu’une fois les résultats saisis.";
  }

  function champFiltre(p) {
    const n = (p.options || []).length;
    if (n < 10) return "";
    return '<div class="filtre"><input type="search" placeholder="Chercher un nom" aria-label="Chercher un nom" data-input="filtre" data-pari="' + esc(p.id) + '" data-cle="filtre-' + esc(p.id) + '" value="' + esc(S.filtres[p.id] || "") + '"></div>';
  }
  function appliquerFiltres() {
    app.querySelectorAll('[data-input="filtre"]').forEach((input) => filtrer(input));
  }
  function filtrer(input) {
    const q = norm(input.value.trim());
    S.filtres[input.dataset.pari] = input.value;
    app.querySelectorAll("[data-nom]").forEach((el) => {
      el.classList.toggle("cache", !!q && el.dataset.nom.indexOf(q) < 0);
    });
  }

  function formulaire(p, s, desactive) {
    const dis = desactive ? " disabled" : "";
    const opts = p.options || [];
    if (p.type === "choix") {
      return champFiltre(p) + '<div class="bulletins" role="radiogroup" aria-label="Réponses possibles">' +
        opts.map((o) => {
          const sel = s.option === o.id;
          return '<button type="button" class="bulletin" role="radio" aria-checked="' + sel + '" data-action="choisir" data-pari="' + esc(p.id) + '" data-option="' + esc(o.id) + '" data-cle="o-' + esc(o.id) + '" data-nom="' + esc(norm(o.label)) + '"' + dis + ">" +
            '<span class="bulletin-nom">' + esc(o.label) + '</span><span class="bulletin-parti">' + esc(partiDe(o.id)) + "</span>" +
            (o.pct !== null && o.pct !== undefined ? '<span class="bulletin-gain"><b>+' + nb(avecCoef(p, pointsProba(o.pct))) + "</b><small>" + pctTxt(o.pct) + "</small></span>" : "") +
            "</button>";
        }).join("") + "</div>";
    }
    if (p.type === "oui_non") {
      const reps = s.reponses || {};
      const n = Object.keys(reps).length;
      return '<p class="discret petit">' + nb(n) + " réponse" + (n > 1 ? "s" : "") + " sur " + nb(opts.length) + " noms." + (n ? ' <button type="button" class="bouton-lien" data-action="on-effacer" data-pari="' + esc(p.id) + '"' + dis + ">Tout effacer</button>" : "") + "</p>" +
        champFiltre(p) + '<div class="oui-non">' +
        opts.map((o) => {
          const v = reps[o.id] || "";
          const gOui = o.pct !== null && o.pct !== undefined ? "+" + nb(avecCoef(p, pointsProba(o.pct))) : "";
          const gNon = o.pct !== null && o.pct !== undefined ? "+" + nb(avecCoef(p, pointsProba(100 - o.pct))) : "";
          return '<div class="ligne-on" data-nom="' + esc(norm(o.label)) + '"><span class="nom">' + esc(o.label) + "<small>" + esc(partiDe(o.id)) + (o.pct !== null && o.pct !== undefined ? (partiDe(o.id) ? ", " : "") + "oui à " + pctTxt(o.pct) : "") + "</small></span>" +
            '<div class="segment" role="group" aria-label="' + esc(o.label) + '">' +
            '<button type="button" aria-pressed="' + (v === "oui") + '" data-action="on" data-val="oui" data-pari="' + esc(p.id) + '" data-option="' + esc(o.id) + '" data-cle="on-o-' + esc(o.id) + '"' + dis + ">Oui<small>" + gOui + "</small></button>" +
            '<button type="button" aria-pressed="' + (v === "non") + '" data-action="on" data-val="non" data-pari="' + esc(p.id) + '" data-option="' + esc(o.id) + '" data-cle="on-n-' + esc(o.id) + '"' + dis + ">Non<small>" + gNon + "</small></button>" +
            "</div></div>";
        }).join("") + "</div>";
    }
    if (p.type === "classement") {
      const places = Number(p.config.places) || 3;
      const ordre = s.ordre || [];
      let html = '<ol class="places" aria-label="Ton classement">';
      for (let i = 0; i < places; i++) {
        const id = ordre[i];
        html += '<li class="place' + (id ? " remplie" : "") + '"><span class="place-num">' + (i + 1) + "</span>" +
          (id
            ? '<button type="button" data-action="vider-place" data-pari="' + esc(p.id) + '" data-i="' + i + '" data-cle="place-' + i + '" aria-label="Retirer ' + esc(libelle(p, id)) + ' de la place ' + (i + 1) + '"' + dis + "><span>" + esc(libelle(p, id)) + "</span>" + ICONES.croix + "</button>"
            : '<span class="libre">' + (i === ordre.length ? "Choisis un nom ci-dessous" : "") + "</span>") +
          "</li>";
      }
      html += "</ol>";
      if (p.config.sens === "bas") html += '<p class="discret petit">La place 1 est le tout dernier.</p>';
      html += champFiltre(p) + '<div class="bulletins">' +
        opts.map((o) => {
          const place = ordre.indexOf(o.id);
          const plein = ordre.length >= places;
          return '<button type="button" class="bulletin" aria-pressed="' + (place >= 0) + '" data-action="placer" data-pari="' + esc(p.id) + '" data-option="' + esc(o.id) + '" data-cle="o-' + esc(o.id) + '" data-nom="' + esc(norm(o.label)) + '"' + (desactive || (plein && place < 0) ? " disabled" : "") + ">" +
            '<span class="bulletin-nom">' + esc(o.label) + '</span><span class="bulletin-parti">' + (place >= 0 ? "Place " + (place + 1) : esc(partiDe(o.id))) + "</span>" +
            (o.pct !== null && o.pct !== undefined ? '<span class="bulletin-gain"><b>+' + nb(avecCoef(p, pointsProba(o.pct))) + "</b><small>" + pctTxt(o.pct) + "</small></span>" : "") +
            "</button>";
        }).join("") + "</div>";
      return html;
    }
    if (p.type === "estimation") {
      const cfg = p.config || {};
      const pas = cfg.decimales ? Math.pow(10, -cfg.decimales) : 1;
      const min = cfg.min !== undefined ? cfg.min : 0;
      const max = cfg.max !== undefined ? cfg.max : 100;
      const v = s.valeur === "" || s.valeur === null || s.valeur === undefined ? "" : String(s.valeur);
      return '<div class="carte"><div class="estimation">' +
        '<label class="champ" style="margin:0"><span>Ta réponse</span><span class="ligne" style="flex-wrap:nowrap"><input type="number" inputmode="decimal" step="' + pas + '" min="' + esc(min) + '" max="' + esc(max) + '" value="' + esc(v) + '" data-input="valeur" data-pari="' + esc(p.id) + '" data-cle="valeur"' + dis + '><span class="unite">' + esc(cfg.unite || "") + "</span></span></label>" +
        '<div><input type="range" aria-label="Ajuster ta réponse" step="' + pas + '" min="' + esc(min) + '" max="' + esc(max) + '" value="' + esc(v === "" ? (min + max) / 2 : v) + '" data-input="valeur-curseur" data-pari="' + esc(p.id) + '"' + dis + '><div class="ligne entre petit discret"><span>' + esc(min) + "</span><span>" + esc(max) + "</span></div></div>" +
        "</div></div>" + tableauEcarts(p);
    }
    if (p.type === "scores") {
      const v = s.valeurs || {};
      return champFiltre(p) + '<div class="carte"><div class="defile"><table class="admin-table scores-saisie"><tbody>' +
        opts.map((o) => '<tr data-nom="' + esc(norm(o.label)) + '"><td><strong>' + esc(o.label) + '</strong><br><small class="discret">' + esc(partiDe(o.id)) + "</small></td>" +
          '<td class="pct"><span class="ligne" style="flex-wrap:nowrap;gap:.375rem"><input type="number" inputmode="decimal" step="0.1" min="0" max="100" value="' + esc(v[o.id] === undefined || v[o.id] === null ? "" : v[o.id]) + '" data-input="score" data-pari="' + esc(p.id) + '" data-option="' + esc(o.id) + '" data-cle="sc-' + esc(o.id) + '" aria-label="Score de ' + esc(o.label) + '"' + dis + '><span class="unite">%</span></span></td></tr>'
        ).join("") + "</tbody></table></div>" +
        '<p class="petit discret" style="margin:.75rem 0 0" id="total-scores">' + texteTotalScores(p, s) + "</p></div>";
    }
    if (p.type === "vote") {
      const select = (champ, titre) =>
        '<label class="champ"><span>' + titre + '</span><select data-input="vote" data-champ="' + champ + '" data-pari="' + esc(p.id) + '" data-cle="vote-' + champ + '"' + dis + '><option value="">Je ne réponds pas</option>' +
        opts.map((o) => '<option value="' + esc(o.id) + '"' + (s[champ] === o.id ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select></label>";
      return '<div class="carte">' + select("vais", "Je vais voter pour") + select("voudrais", "J’aimerais voter pour") +
        '<p class="discret petit" style="margin:0">Facultatif. Personne ne vérifie : tu peux répondre ce que tu veux. Réponses dévoilées une fois les résultats saisis.</p></div>';
    }
    return "";
  }

  function texteTotalScores(p, s) {
    const v = (s && s.valeurs) || {};
    let total = 0;
    let n = 0;
    (p.options || []).forEach((o) => {
      const x = Number(String(v[o.id] === undefined ? "" : v[o.id]).replace(",", "."));
      if (v[o.id] !== "" && v[o.id] !== undefined && v[o.id] !== null && isFinite(x)) { total += x; n++; }
    });
    return "Total : " + pctTxt(Math.round(total * 10) / 10) + ", " + nb(n) + " score" + (n > 1 ? "s" : "") + " sur " + nb((p.options || []).length) + ". Les scores de tous les candidats font 100 %.";
  }

  function tableauEcarts(p) {
    const pente = Number(p.config.pente) || 10;
    const ecarts = [0, 0.5, 1, 2, 5].filter((x, i) => i === 0 || 100 - pente * x > 0 || x === 1);
    const unite = p.config.unite === "%" ? " pt" : "";
    return '<table class="exemples"><thead><tr><th>Écart avec le résultat</th><th>Points</th></tr></thead><tbody>' +
      ecarts.map((x) => "<tr><td>" + String(x).replace(".", ",") + unite + "</td><td>" + nb(avecCoef(p, Math.max(0, Math.round(100 - pente * x)))) + "</td></tr>").join("") +
      "<tr><td>" + String(Math.round((100 / pente) * 100) / 100).replace(".", ",") + unite + " ou plus</td><td>0</td></tr></tbody></table>";
  }

  function barreAction(p) {
    const s = saisieDe(p);
    const complet = saisieComplete(p, s);
    const enregistre = p.monProno && memeReponse(p.monProno.reponse, s);
    let statut;
    if (enregistre) statut = '<span class="mini-tampon">Parié</span> <span class="discret petit">Modifiable jusqu’à la clôture</span>';
    else if (p.monProno) statut = '<span class="a-faire-etiquette">Modification non enregistrée</span>';
    else statut = '<span class="discret petit">' + (complet ? "Prêt à valider" : "Pas encore de pari") + "</span>";
    return '<div class="action-pari"><div>' + statut +
      (p.monProno ? ' <button type="button" class="bouton-lien" data-action="retirer" data-pari="' + esc(p.id) + '">Retirer mon pari</button>' : "") + "</div>" +
      '<button type="button" class="bouton bouton-rouge" data-action="enregistrer" data-pari="' + esc(p.id) + '" data-cle="enregistrer"' + (complet && !enregistre ? "" : " disabled") + ">" +
      (p.monProno ? "Enregistrer la modification" : "Valider mon pari") + "</button></div>";
  }

  function resumeReponse(p, r) {
    if (!r) return "";
    if (p.type === "choix") return esc(libelle(p, r.option));
    if (p.type === "oui_non") {
      const reps = r.reponses || {};
      const oui = Object.keys(reps).filter((k) => reps[k] === "oui").length;
      const non = Object.keys(reps).filter((k) => reps[k] === "non").length;
      return pluriel(oui, "oui", "oui") + ", " + pluriel(non, "non", "non");
    }
    if (p.type === "classement") return (r.ordre || []).map((id, i) => (i + 1) + ". " + esc(libelle(p, id))).join("<br>");
    if (p.type === "estimation") return esc(String(r.valeur).replace(".", ",")) + " " + esc(p.config.unite || "");
    if (p.type === "scores") {
      const v = r.valeurs || {};
      return Object.keys(v).sort((a, b) => v[b] - v[a]).slice(0, 3).map((id) => esc(libelle(p, id)) + " " + pctTxt(v[id])).join(", ") + (Object.keys(v).length > 3 ? "…" : "");
    }
    if (p.type === "vote") {
      return (r.vais ? "Va voter : " + esc(libelle(p, r.vais)) : "") + (r.vais && r.voudrais ? "<br>" : "") + (r.voudrais ? "Aimerait : " + esc(libelle(p, r.voudrais)) : "");
    }
    return "";
  }

  function maReponse(p) {
    if (!p.monProno) return '<div class="message">Tu n’as pas parié sur celui-ci.</div>';
    const pts = p.etat === "resolu" && p.type !== "vote"
      ? '<div class="gain' + (p.monProno.points ? "" : " gain-nul") + '" style="font-size:2.5rem">+' + nb(p.monProno.points) + '</div><div class="discret petit">' + pluriel(p.monProno.points, "point gagné", "points gagnés") + "</div>"
      : "";
    return '<div class="ma-reponse"><div class="ligne entre" style="align-items:flex-start"><div><h3>Ton pari</h3><div>' + resumeReponse(p, p.monProno.reponse) + "</div>" +
      (p.monProno.modifs ? '<div class="discret petit" style="margin-top:.5rem">Modifié ' + pluriel(p.monProno.modifs, "fois", "fois") + "</div>" : "") +
      "</div><div style=\"text-align:right\">" + pts + "</div></div></div>";
  }

  function barres(lignes, max) {
    max = Math.max(1, max);
    return '<ul class="barres">' + lignes.map((l) =>
      '<li class="barre' + (l.juste ? " juste" : "") + (l.moi ? " moi" : "") + '"><span class="etiquette">' + esc(l.label) +
      (l.note ? "<small>" + l.note + "</small>" : "") + '</span><span class="piste"><span class="remplissage" style="width:' + Math.round((l.valeur / max) * 100) + '%"></span></span><span class="valeur">' + esc(l.valeurTxt !== undefined ? l.valeurTxt : nb(l.valeur)) + "</span></li>"
    ).join("") + "</ul>";
  }

  function devoilement(p) {
    if (!p.devoile) {
      if (p.type === "vote") return '<div class="message">Les réponses du groupe seront dévoilées une fois les résultats saisis.</div>';
      return "";
    }
    const st = p.stats || {};
    const res = p.resultat;
    const mien = p.monProno ? p.monProno.reponse : null;
    const joueurs = parId(S.etat.joueurs);
    let html = '<div class="section-titre"><h2>Ce qu’a parié le groupe</h2><span>' + pluriel(st.participants || 0, "participant") + "</span></div>";
    if (!st.participants) return html + '<div class="vide"><p>Personne n’a parié sur celui-ci.</p></div>';

    if (p.type === "choix") {
      const lignes = p.options.map((o) => ({
        label: o.label, valeur: st.compte[o.id] || 0,
        juste: res && res.option === o.id, moi: mien && mien.option === o.id,
        note: [res && res.option === o.id ? '<span class="marque-resultat">Bonne réponse</span>' : "", mien && mien.option === o.id ? "ton choix" : ""].filter(Boolean).join(", "),
      })).filter((l) => l.valeur > 0 || l.juste).sort((a, b) => b.valeur - a.valeur);
      html += barres(lignes, Math.max.apply(null, lignes.map((l) => l.valeur)));
    } else if (p.type === "oui_non") {
      const oui = st.oui || {};
      const non = st.non || {};
      const lignes = p.options.filter((o) => oui[o.id] || non[o.id] || (res && (res.oui || []).indexOf(o.id) >= 0))
        .sort((a, b) => (oui[b.id] || 0) - (oui[a.id] || 0));
      const max = Math.max.apply(null, [1].concat(lignes.map((o) => (oui[o.id] || 0) + (non[o.id] || 0))));
      html += '<div class="legende"><span><i style="background:var(--encre-2)"></i>Oui</span><span><i style="background:var(--filet-fort)"></i>Non</span></div>';
      html += '<ul class="barres">' + lignes.map((o) => {
        const nO = oui[o.id] || 0;
        const nN = non[o.id] || 0;
        const verdict = res ? ((res.oui || []).indexOf(o.id) >= 0 ? '<span class="marque-resultat">Résultat : oui</span>' : "Résultat : non") : "";
        return '<li class="barre barre-double"><span class="etiquette">' + esc(o.label) + (verdict ? "<small>" + verdict + "</small>" : "") + '</span><span class="piste">' +
          '<span class="oui" style="width:' + Math.round((nO / max) * 100) + '%"></span><span class="non" style="width:' + Math.round((nN / max) * 100) + '%"></span></span>' +
          '<span class="valeur">' + nO + "/" + nN + "</span></li>";
      }).join("") + "</ul>";
    } else if (p.type === "classement") {
      if (res) html += '<div class="carte" style="margin-bottom:1rem"><h3 style="margin-top:0">Résultat</h3><ol style="margin:0;padding-left:1.25rem">' + (res.ordre || []).map((id) => "<li><strong>" + esc(libelle(p, id)) + "</strong></li>").join("") + "</ol></div>";
      const compte = st.compte || {};
      const lignes = p.options.filter((o) => compte[o.id]).map((o) => {
        const parPlace = (st.parPlace && st.parPlace[o.id]) || [];
        const pos = res ? (res.ordre || []).indexOf(o.id) : -1;
        return {
          label: o.label, valeur: compte[o.id], juste: pos >= 0, moi: mien && (mien.ordre || []).indexOf(o.id) >= 0,
          note: (parPlace[0] ? parPlace[0] + " à la place 1" : "") + (pos >= 0 ? (parPlace[0] ? ", " : "") + '<span class="marque-resultat">place ' + (pos + 1) + " en vrai</span>" : ""),
        };
      }).sort((a, b) => b.valeur - a.valeur);
      html += '<p class="discret petit">Nombre de joueurs qui ont mis chaque nom dans leur classement.</p>' + barres(lignes, Math.max.apply(null, [1].concat(lignes.map((l) => l.valeur))));
    } else if (p.type === "estimation") {
      html += graphiqueEstimations(p);
    } else if (p.type === "scores") {
      const moy = st.moyennes || {};
      const reels = res && res.valeurs ? res.valeurs : {};
      const mes = mien && mien.valeurs ? mien.valeurs : {};
      const lignes = p.options.slice().sort((a, b) => (reels[b.id] !== undefined ? reels[b.id] : moy[b.id] || 0) - (reels[a.id] !== undefined ? reels[a.id] : moy[a.id] || 0));
      html += '<div class="defile"><table class="table-joueurs"><thead><tr><th>Candidat</th>' + (res ? '<th class="num">Résultat</th>' : "") + '<th class="num">Moyenne du groupe</th>' + (mien ? '<th class="num">Ton prono</th>' : "") + "</tr></thead><tbody>" +
        lignes.map((o) => "<tr><td>" + esc(o.label) + "</td>" + (res ? '<td class="num"><strong>' + (reels[o.id] !== undefined ? pctTxt(reels[o.id]) : "") + "</strong></td>" : "") +
          '<td class="num">' + (moy[o.id] !== undefined ? pctTxt(moy[o.id]) : "") + "</td>" + (mien ? '<td class="num">' + (mes[o.id] !== undefined ? pctTxt(mes[o.id]) : "") + "</td>" : "") + "</tr>").join("") +
        "</tbody></table></div>";
    } else if (p.type === "vote") {
      const bloc = (titre, compte) => {
        const lignes = p.options.filter((o) => compte[o.id]).map((o) => ({ label: o.label, valeur: compte[o.id] })).sort((a, b) => b.valeur - a.valeur);
        return "<h3>" + titre + "</h3>" + (lignes.length ? barres(lignes, lignes[0].valeur) : '<p class="discret">Aucune réponse.</p>');
      };
      html += bloc("Va voter pour", st.vais || {}) + bloc("Aimerait voter pour", st.voudrais || {});
      const pcts = res && res.pourcentages ? res.pourcentages : {};
      const officiel = p.options.filter((o) => pcts[o.id] !== undefined).map((o) => ({ label: o.label, valeur: pcts[o.id], valeurTxt: pctTxt(pcts[o.id]) })).sort((a, b) => b.valeur - a.valeur);
      if (officiel.length) html += "<h3>Résultat officiel</h3>" + barres(officiel, officiel[0].valeur);
    }

    const lignes = (p.pronos || []).slice().sort((a, b) => (p.etat === "resolu" ? b.points - a.points : 0) || ((joueurs[a.joueur] || {}).pseudo || "").localeCompare((joueurs[b.joueur] || {}).pseudo || ""));
    html += '<h3>Le détail, joueur par joueur</h3><div class="defile"><table class="table-joueurs"><thead><tr><th>Joueur</th><th>Pari</th>' +
      (p.etat === "resolu" && p.type !== "vote" ? '<th class="num">Points</th>' : "") + "</tr></thead><tbody>" +
      lignes.map((l) => {
        const j = joueurs[l.joueur] || { pseudo: "?", guilde: "" };
        return '<tr class="' + (l.joueur === S.etat.moi.id ? "moi" : "") + '"><td>' + esc(j.pseudo) + "<br>" + badgeGuilde(j.guilde) + "</td><td>" + resumeReponse(p, l.reponse) + "</td>" +
          (p.etat === "resolu" && p.type !== "vote" ? '<td class="num">' + nb(l.points) + "</td>" : "") + "</tr>";
      }).join("") + "</tbody></table></div>";
    return html;
  }

  function graphiqueEstimations(p) {
    const st = p.stats || {};
    const valeurs = st.valeurs || [];
    const res = p.resultat ? Number(p.resultat.valeur) : null;
    const tous = valeurs.concat(res !== null ? [res] : []);
    let min = Math.min.apply(null, tous);
    let max = Math.max.apply(null, tous);
    if (min === max) { min -= 1; max += 1; }
    const marge = (max - min) * 0.08;
    min -= marge;
    max += marge;
    const L = largeurGraphique(), H = 150, g = 24, d = 24;
    const x = (v) => g + ((v - min) / (max - min)) * (L - g - d);
    const piles = {};
    let points = "";
    const mien = p.monProno ? Number(p.monProno.reponse.valeur) : null;
    let dejaMien = false;
    valeurs.forEach((v) => {
      const cle = Math.round(x(v) / 10);
      piles[cle] = (piles[cle] || 0) + 1;
      const cy = 100 - (piles[cle] - 1) * 12;
      const estMien = !dejaMien && mien !== null && v === mien;
      if (estMien) dejaMien = true;
      points += '<circle cx="' + x(v).toFixed(1) + '" cy="' + Math.max(8, cy) + '" r="5.5" fill="' + (estMien ? "var(--tampon)" : "var(--encre-2)") + '" opacity="' + (estMien ? 1 : 0.75) + '"><title>' + esc(String(v).replace(".", ",")) + "</title></circle>";
    });
    const graduations = [];
    const pasG = (max - min) / 4;
    for (let i = 0; i <= 4; i++) graduations.push(min + pasG * i);
    let svg = '<svg class="graphique" viewBox="0 0 ' + L + " " + H + '" role="img" aria-label="Répartition des réponses du groupe">' +
      '<line class="axe" x1="' + g + '" y1="112" x2="' + (L - d) + '" y2="112"/>' +
      graduations.map((v) => '<text x="' + x(v).toFixed(1) + '" y="130" text-anchor="middle">' + esc((Math.round(v * 10) / 10).toString().replace(".", ",")) + "</text>").join("") +
      points;
    if (res !== null) {
      svg += '<line x1="' + x(res).toFixed(1) + '" y1="4" x2="' + x(res).toFixed(1) + '" y2="116" stroke="var(--vert)" stroke-width="3"/>' +
        '<text x="' + x(res).toFixed(1) + '" y="146" text-anchor="middle" style="fill:var(--vert);font-weight:700">Résultat</text>';
    }
    svg += "</svg>";
    return '<div class="carte">' + svg + '<div class="legende"><span><i style="background:var(--encre-2)"></i>Une réponse</span>' +
      (mien !== null ? '<span><i style="background:var(--tampon)"></i>Ta réponse</span>' : "") +
      (res !== null ? '<span><i style="background:var(--vert)"></i>Résultat : ' + esc(String(res).replace(".", ",")) + " " + esc(p.config.unite || "") + "</span>" : "") + "</div>" +
      '<p class="petit discret" style="margin:0">Moyenne du groupe : ' + esc(String(st.moyenne).replace(".", ",")) + ", médiane : " + esc(String(st.mediane).replace(".", ",")) + ".</p></div>";
  }

  function sectionDuels(p, e) {
    const joueurs = parId(e.joueurs);
    const mes = p.duels || [];
    let html = '<div class="section-titre"><h2>Duels</h2></div>';
    html += '<p class="discret petit">Tu peux lancer un seul duel par pari : choisis bien ton adversaire. Celui de vous deux qui marque le plus de points sur ce pari gagne ' + BONUS_DUEL + ' points de bonus, le perdant ne perd rien. Si l’un de vous deux n’a pas parié, le duel est annulé.</p>';
    if (mes.length) {
      html += '<ul class="barres" style="margin-bottom:1rem">' + mes.map((d) => {
        const autre = d.lanceur === e.moi.id ? d.adversaire : d.lanceur;
        const nom = (joueurs[autre] || {}).pseudo || "?";
        let issue = "En cours";
        if (d.statut === "annule") issue = "Annulé : l’un de vous deux n’a pas parié";
        if (d.statut === "nul") issue = "Égalité, " + nb(d.pointsLanceur) + " partout";
        if (d.statut === "termine") {
          const mesPts = d.lanceur === e.moi.id ? d.pointsLanceur : d.pointsAdversaire;
          const sesPts = d.lanceur === e.moi.id ? d.pointsAdversaire : d.pointsLanceur;
          issue = (d.gagnant === e.moi.id ? "Gagné " : "Perdu ") + nb(mesPts) + " à " + nb(sesPts) + (d.gagnant === e.moi.id ? ", +" + BONUS_DUEL + " points" : "");
        }
        return '<li class="ligne entre carte" style="padding:.625rem .875rem"><span>Toi contre <strong>' + esc(nom) + "</strong>" +
          (d.lanceur === e.moi.id ? "" : ' <span class="discret petit">(il t’a défié)</span>') + "</span><strong>" + esc(issue) + "</strong></li>";
      }).join("") + "</ul>";
    }
    const dejaLance = mes.some((d) => d.lanceur === e.moi.id);
    if (p.etat === "ouvert" && dejaLance) {
      html += '<p class="discret">Tu as lancé ton duel sur ce pari.</p>';
    } else if (p.etat === "ouvert") {
      const exclus = {};
      exclus[e.moi.id] = true;
      mes.forEach((d) => { exclus[d.lanceur] = true; exclus[d.adversaire] = true; });
      const dispo = e.joueurs.filter((j) => !exclus[j.id]);
      if (dispo.length) {
        html += '<div class="ligne"><select id="duel-adversaire" style="flex:1 1 12rem;width:auto" aria-label="Joueur à défier">' +
          dispo.map((j) => '<option value="' + esc(j.id) + '">' + esc(j.pseudo) + "</option>").join("") + "</select>" +
          '<button type="button" class="bouton bouton-clair" data-action="duel" data-pari="' + esc(p.id) + '">Lancer le duel</button></div>';
      } else {
        html += '<p class="discret">' + (e.joueurs.length <= 1
          ? "Personne à défier pour l’instant : tu es le seul joueur inscrit."
          : "Personne d’autre à défier sur ce pari : tu as déjà un duel en cours avec chacun des autres joueurs.") + "</p>";
      }
    } else if (!mes.length) {
      html += '<p class="discret">Aucun duel sur ce pari.</p>';
    }
    return html;
  }

  // ======================================================================
  // Classement
  // ======================================================================

  async function vueClassement(onglet) {
    const res = await Promise.all([chargerEtat(), chargerClassement(true)]);
    const e = res[0];
    const cl = res[1];
    const onglets = [["joueurs", "Joueurs"], ["guildes", "Guildes"], ["evolution", "Évolution"], ["trophees", "Trophées"]];
    let html = "<h1>Classement</h1>" +
      '<nav class="onglets" aria-label="Vues du classement">' + onglets.map((o) => '<a href="#/classement/' + o[0] + '"' + (o[0] === onglet ? ' aria-current="page"' : "") + ">" + o[1] + "</a>").join("") + "</nav>";
    if (onglet === "guildes") html += vueGuildes(cl);
    else if (onglet === "evolution") html += vueEvolution(cl, e);
    else if (onglet === "trophees") html += vueTrophees(cl);
    else html += vueJoueurs(cl, e);
    rendre(html);
  }

  function vueJoueurs(cl, e) {
    if (!cl.joueurs.length) return '<div class="vide"><p>Aucun joueur pour l’instant.</p></div>';
    const max = Math.max(1, cl.joueurs[0].points);
    const guildes = parId(e.guildes);
    return '<p class="discret petit">Points cumulés sur tous les paris dont le résultat est connu. Les ex æquo partagent le même rang.</p><ol class="rangs">' +
      cl.joueurs.map((j) => {
        const g = guildes[j.guilde] || {};
        return '<li class="rang' + (j.id === e.moi.id ? " moi" : "") + '"><span class="rang-num">' + j.rang + '</span><span class="rang-nom"><strong>' + esc(j.pseudo) + "</strong>" + badgeGuilde(j.guilde) +
          '<span class="rang-piste" style="--c:' + esc(g.couleur || "") + '"><span style="width:' + Math.round((j.points / max) * 100) + '%"></span></span></span>' +
          '<span class="rang-points"><b>' + nb(j.points) + "</b><small>" + pluriel(j.nbParis, "pari") + "</small></span></li>";
      }).join("") + "</ol>";
  }

  function vueGuildes(cl) {
    const max = Math.max(1, Math.max.apply(null, cl.guildes.map((g) => g.moyenne)));
    return '<p class="discret petit">Classement sur la moyenne des points des membres : une petite guilde a autant de chances qu’une grande.</p><ol class="rangs">' +
      cl.guildes.map((g) =>
        '<li class="rang' + (S.etat && g.id === S.etat.moi.guilde ? " moi" : "") + '"><span class="rang-num">' + g.rang + '</span><span class="rang-nom"><strong>' + esc(g.nom) + '</strong><span class="guilde">' + pluriel(g.membres, "membre") + ", " + pluriel(g.total, "point") + " au total</span>" +
        '<span class="rang-piste" style="--c:' + esc(g.couleur) + '"><span style="width:' + Math.round((g.moyenne / max) * 100) + '%"></span></span></span>' +
        '<span class="rang-points"><b>' + nb(g.moyenne) + "</b><small>de moyenne</small></span></li>"
      ).join("") + "</ol>";
  }

  function vueEvolution(cl, e) {
    const etapes = cl.evolution.etapes;
    if (!etapes.length) return '<div class="vide"><p>La courbe apparaîtra dès que le premier résultat sera saisi.</p></div>';
    const series = cl.evolution.series;
    const top = cl.joueurs.slice(0, 5).map((j) => j.id);
    if (top.indexOf(e.moi.id) < 0 && series[e.moi.id]) top.push(e.moi.id);
    const pseudo = parId(e.joueurs);
    const L = largeurGraphique(), H = L < 500 ? 240 : 300, g = 44, d = 16, h = 16, b = 34;
    const n = etapes.length;
    let maxY = 0;
    top.forEach((id) => (series[id] || []).forEach((v) => { if (v > maxY) maxY = v; }));
    const brut = Math.max(10, maxY) / 4;
    const puissance = Math.pow(10, Math.floor(Math.log10(brut)));
    const r = brut / puissance;
    const pasY = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * puissance;
    maxY = Math.max(pasY, Math.ceil(maxY / pasY) * pasY);
    const x = (i) => g + (i / n) * (L - g - d);
    const y = (v) => h + (1 - v / maxY) * (H - h - b);
    let svg = '<svg class="graphique" viewBox="0 0 ' + L + " " + H + '" role="img" aria-label="Évolution des points des premiers du classement">';
    for (let v = 0; v <= maxY; v += pasY) {
      svg += '<line class="grille" x1="' + g + '" y1="' + y(v) + '" x2="' + (L - d) + '" y2="' + y(v) + '"/><text x="' + (g - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + nb(v) + "</text>";
    }
    const saut = Math.max(1, Math.ceil(n / Math.floor((L - g - d) / 34)));
    for (let i = 0; i <= n; i++) {
      if (i === 0 || i === n || i % saut === 0) svg += '<text x="' + x(i) + '" y="' + (H - 12) + '" text-anchor="' + (i === 0 ? "start" : "middle") + '">' + (i === 0 ? "Départ" : i) + "</text>";
    }
    let legende = "";
    top.forEach((id, k) => {
      const moi = id === e.moi.id;
      const couleur = moi ? "var(--tampon)" : COULEURS_COURBES[k % COULEURS_COURBES.length];
      const pts = [[x(0), y(0)]].concat((series[id] || []).map((v, i) => [x(i + 1), y(v)]));
      svg += '<polyline fill="none" stroke="' + couleur + '" stroke-width="' + (moi ? 4 : 2.5) + '" stroke-linejoin="round" stroke-linecap="round" points="' + pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ") + '"/>';
      const dernier = pts[pts.length - 1];
      svg += '<circle cx="' + dernier[0].toFixed(1) + '" cy="' + dernier[1].toFixed(1) + '" r="' + (moi ? 5 : 4) + '" fill="' + couleur + '"/>';
      legende += '<span><i style="background:' + couleur + '"></i>' + esc((pseudo[id] || {}).pseudo || "?") + (moi ? " (toi)" : "") + "</span>";
    });
    svg += "</svg>";
    return '<div class="carte">' + svg + '<div class="legende">' + legende + "</div></div>" +
      '<h3>Les étapes</h3><ol class="petit discret">' + etapes.map((t) => "<li>" + esc(t.titre) + ", résultat du " + court(dms(t.date)) + "</li>").join("") + "</ol>";
  }

  // Largeur du dessin calée sur l'écran, pour que le texte des graphiques reste lisible sur mobile.
  function largeurGraphique() {
    return Math.round(Math.min(640, Math.max(300, (app.clientWidth || 640) - 44)));
  }

  function iconeMedaille(pleine) {
    return ICONES.medaille.replace(/MEDAILLE/g, pleine ? "medaille" : "medaille-vide").replace(/RUBAN/g, pleine ? "ruban" : "ruban-vide");
  }

  function vueTrophees(cl) {
    return '<div class="message message-info">' + (cl.termine ? "Le jeu est terminé : voici les trophées définitifs." : "Classement provisoire : les trophées seront remis après le second tour. Les ex æquo reçoivent tous le trophée.") + "</div>" +
      '<div class="trophees">' + cl.trophees.map((t) => {
        const tenants = t.gagnants.length
          ? t.gagnants.slice(0, 4).map((g) => esc(g.pseudo)).join(", ") + (t.gagnants.length > 4 ? " et " + (t.gagnants.length - 4) + " autres" : "")
          : "";
        return '<div class="trophee">' + iconeMedaille(!!t.gagnants.length) + "<div><h3>" + esc(t.nom) + "</h3><p>" + esc(t.description) + "</p>" +
          (tenants ? '<div class="tenant">' + (cl.termine ? "" : "En tête : ") + tenants + "<small>" + esc(t.detail) + "</small></div>" : '<div class="discret petit">Pas encore attribué</div>') +
          "</div></div>";
      }).join("") + "</div>";
  }

  // ======================================================================
  // Calendrier
  // ======================================================================

  // Chaque date clé est rangée dans une seule étape : celle qu'elle termine ou qu'elle traverse.
  function phaseDuJalon(phases, t) {
    for (let i = 0; i < phases.length; i++) {
      if (t > dateConfig(phases[i].debut) && t <= dateConfig(phases[i].fin)) return phases[i];
    }
    if (phases.length && t > dateConfig(phases[phases.length - 1].fin)) return phases[phases.length - 1];
    return phases[0];
  }

  async function vueCalendrier() {
    const e = await chargerEtat();
    const phases = JEU.calendrier || [];
    const now = maintenant();
    const debut = dateConfig(phases[0] && phases[0].debut);
    const fin = dateConfig(phases.length ? phases[phases.length - 1].fin : "");
    const total = Math.max(1, fin - debut);
    let html = "<h1>Calendrier</h1><p class=\"discret\">Les grandes étapes de l’élection et les paris de chacune. Les dates marquées comme estimées seront confirmées par le décret de convocation des électeurs.</p>";

    html += '<div class="frise" role="img" aria-label="Avancement du jeu">' + phases.map((ph) => {
      const d = dateConfig(ph.debut);
      const f = dateConfig(ph.fin);
      const cls = now >= f ? "passee" : now >= d ? "en-cours" : "";
      return '<div class="frise-phase ' + cls + '" style="width:' + (((f - d) / total) * 100).toFixed(2) + '%">' + esc(ph.nom) + "</div>";
    }).join("");
    const pos = Math.min(100, Math.max(0, ((now - debut) / total) * 100));
    html += '<div class="frise-curseur" style="left:calc(' + pos.toFixed(2) + '% - 1px)"><span>Aujourd’hui</span></div></div>';

    html += '<ol class="chrono">' + phases.map((ph) => {
      const d = dateConfig(ph.debut);
      const f = dateConfig(ph.fin);
      const cls = now >= f ? "passee" : now >= d ? "en-cours" : "";
      const elements = [];
      (JEU.jalons || []).forEach((j) => {
        const t = dateConfig(j.date);
        if (phaseDuJalon(phases, t) === ph) elements.push({ t: t, html: '<li class="jalon"><span class="quand">' + court(t) + "</span><span>" + esc(j.label) + (j.estimation ? ' <span class="estimee">date estimée</span>' : "") + "</span><span></span></li>" });
      });
      e.paris.filter((p) => p.phase === ph.phase && p.etat !== "brouillon").forEach((p) => {
        const t = dms(p.cloture);
        elements.push({ t: t, html: '<li><a href="#/pari/' + esc(p.id) + '"><span class="quand">' + court(t) + "</span><span>" + esc(p.titre) + "</span>" + puceEtat(p) + "</a></li>" });
      });
      elements.sort((a, b) => a.t - b.t);
      return '<li class="etape ' + cls + '"><h2>' + esc(ph.nom) + "</h2>" +
        '<div class="dates">Du ' + jour(d) + " au " + jour(f) + (ph.estimation ? ' <span class="estimee">dates estimées</span>' : "") + (cls === "en-cours" ? ", en cours" : "") + "</div>" +
        "<p>" + esc(ph.texte || "") + "</p>" +
        (elements.length ? '<p class="petit discret" style="margin:0">Les paris sont classés par date de clôture.</p><ul>' + elements.map((x) => x.html).join("") + "</ul>" : "") +
        "</li>";
    }).join("") + "</ol>";
    rendre(html);
  }

  // ======================================================================
  // Règles : la documentation intégrée
  // ======================================================================

  function vueRegles(hash) {
    const exemples = [90, 50, 25, 10, 5, 1];
    const calendrier = (JEU.calendrier || []).map((ph) =>
      "<li><strong>" + esc(ph.nom) + "</strong>, du " + jour(dateConfig(ph.debut)) + " au " + jour(dateConfig(ph.fin)) + (ph.estimation ? " (dates estimées)" : "") + ".<br>" + esc(ph.texte || "") + "</li>"
    ).join("");
    const trophees = [
      ["Le Champion", "Le plus de points au classement général."],
      ["Le Boulet d’or", "Le moins de points au classement général."],
      ["Le Grand Déçu", "Son candidat de cœur du 1er tour, déclaré dans « Mon vote », a fait le plus petit score."],
      ["Le Visionnaire", "A trouvé la bonne réponse la moins probable."],
      ["Le Sniper", "Le plus de points sur les paris d’estimation et de scores."],
      ["Le Duelliste", "Le plus de duels gagnés."],
      ["Le Kamikaze", "Le plus de réponses sur des probabilités de moins de 10 %."],
      ["La Girouette", "Le plus de paris modifiés avant la clôture."],
      ["Le Mouton", "Le plus souvent du même avis que la majorité du groupe, sur les paris à un seul choix."],
      ["Le Retardataire", "Le plus de paris posés dans la dernière heure avant la clôture."],
    ];
    const connecte = pb.authStore.isValid;
    const html =
      (connecte ? "" : '<a class="retour" href="#/connexion">' + ICONES.retour + "Connexion</a>") +
      '<div class="regles"><h1>Comment ça marche</h1>' +
      '<ol class="sommaire">' +
      [["principe", "Le principe"], ["etapes", "Les étapes"], ["points", "Les points"], ["types", "Les types de paris"], ["cloture", "Clôture et secret"],
        ["duels", "Les duels"], ["guildes", "Les guildes"], ["grades", "Les grades"], ["trophees", "Les trophées"], ["questions", "Questions fréquentes"], ["donnees", "Tes données"]]
        .map((s) => '<li><a href="#/regles/' + s[0] + '">' + s[1] + "</a></li>").join("") + "</ol>" +

      '<section id="r-principe"><h2>Le principe</h2>' +
      "<p>Chaque joueur fait des pronostics sur la présidentielle 2027 : qui aura ses 500 signatures, qui finira sur le podium, les scores de chaque candidat, l’abstention, qui sera élu. Les paris ouvrent et ferment au fil du calendrier électoral.</p>" +
      "<p>Une bonne réponse rapporte des points, d’autant plus qu’elle était improbable. Une mauvaise réponse rapporte 0 : on ne perd jamais de points. Les points s’additionnent jusqu’au second tour, puis les trophées sont remis. Il n’y a ni argent, ni mise.</p></section>" +

      '<section id="r-etapes"><h2>Les étapes</h2><ol>' + calendrier + "</ol>" +
      '<p>Le <a href="#/calendrier">calendrier</a> montre les paris de chaque étape et leurs dates de clôture.</p></section>' +

      '<section id="r-points"><h2>Les points</h2>' +
      "<p>Chaque réponse possible a une probabilité, établie d’après les sondages. Pour les paris du 1er tour, le jeu la calcule à partir de la moyenne des intentions de vote. Elle est affichée sur chaque réponse, avec le nombre de points qu’elle rapporte.</p>" +
      '<div class="formule">Points gagnés = 10 ÷ <b>probabilité</b>, au plus ' + PLAFOND_POINTS + "</div>" +
      "<p>Une réponse donnée à 41 % rapporte 10 ÷ 0,41, soit 24 points. Plus la réponse est improbable, plus elle rapporte, jusqu’à " + PLAFOND_POINTS + " points : sous 3,4 % environ, le gain ne monte plus. Le classement ne se joue donc pas à la loterie sur un outsider.</p>" +
      '<div class="carte calculette"><label class="champ" style="margin:0"><span>Essaie avec une probabilité</span>' +
      '<input type="range" min="1" max="99" value="20" data-input="calc-pct" aria-describedby="calc-sortie"></label>' +
      '<output id="calc-sortie">50<small>points à 20 %</small></output></div>' +
      '<table class="exemples"><thead><tr><th>Probabilité</th><th>Points</th></tr></thead><tbody>' +
      exemples.map((p) => "<tr><td>" + pctTxt(p) + "</td><td>" + nb(pointsProba(p)) + "</td></tr>").join("") + "</tbody></table>" +
      "<p>Certains paris ont un <strong>coefficient</strong>, affiché sur le pari : les points sont multipliés par ce nombre. Un pari ×2 compte double, un pari ×0,2 compte cinq fois moins. Les gains affichés sur chaque réponse tiennent déjà compte du coefficient.</p>" +
      "<p>Les probabilités, comme le coefficient, sont figées dès qu’un premier joueur a parié : les gains affichés au moment où tu paries sont ceux que tu toucheras.</p></section>" +

      '<section id="r-types"><h2>Les types de paris</h2>' +
      '<h3 id="r-choix">Un seul choix</h3><p>Tu choisis une réponse parmi les bulletins. Si c’est la bonne, tu gagnes 10 ÷ sa probabilité.</p>' +
      '<p class="discret">Exemple : pour « Le Boulet », tu choisis un candidat donné à 5 %. S’il fait bien le plus petit score, tu gagnes 200 points.</p>' +
      '<h3 id="r-oui-non">Oui ou non</h3><p>Pour chaque nom de la liste, tu réponds oui ou non, ou tu passes. Tu réponds pour autant de noms que tu veux. La probabilité affichée est celle du oui ; celle du non est le reste jusqu’à 100 %. Chaque bonne réponse rapporte ses points, ils s’additionnent, et une mauvaise réponse ne coûte rien.</p>' +
      '<p class="discret">Exemple : un candidat est donné à 30 % d’avoir ses signatures. Un oui juste rapporte 10 ÷ 0,30, soit 33 points. Un non juste rapporte 10 ÷ 0,70, soit 14 points. Comme ce pari compte beaucoup de noms, il a souvent un coefficient réduit.</p>' +
      '<h3 id="r-classement">Classement</h3><p>Tu places des noms dans l’ordre, par exemple le podium ou le flop 3 du 1er tour. La probabilité affichée est celle que le nom figure dans ce classement.</p>' +
      "<ul><li>Nom à la bonne place : 10 ÷ probabilité.</li><li>Nom présent dans le classement mais mal placé : la moitié.</li><li>Nom absent du classement : 0.</li></ul>" +
      '<p class="discret">Pour le flop 3, la place 1 est le tout dernier.</p>' +
      '<h3 id="r-estimation">Estimation</h3><p>Tu donnes un nombre, par exemple un taux de participation. Tu pars de 100 points et tu en perds un certain nombre par unité d’écart avec le vrai résultat. Ce nombre est indiqué sur chaque pari. Tu ne descends jamais sous 0.</p>' +
      '<div class="carte calculette"><label class="champ" style="margin:0"><span>Écart avec le résultat, pour 10 points perdus par point d’écart</span>' +
      '<input type="range" min="0" max="12" step="0.1" value="1.5" data-input="calc-ecart" aria-describedby="calc-ecart-sortie"></label>' +
      '<output id="calc-ecart-sortie">85<small>points à 1,5 point d’écart</small></output></div>' +
      '<h3 id="r-scores">Scores</h3><p>Tu donnes le score de chaque candidat, en pourcentage des suffrages exprimés. Pour chaque candidat, tu pars de 100 points et tu en perds un certain nombre par point d’écart avec son vrai score, sans descendre sous 0. Tu gagnes la moyenne de ces points : au plus 100.</p>' +
      '<p class="discret">Exemple, à 10 points perdus par point d’écart : tu donnes 30 % à un candidat qui fait 28 %, cela fait 80 points pour lui. Sur trois candidats à 80, 100 et 60 points, tu gagnes 80 points.</p>' +
      '<h3 id="r-vote">Mon vote</h3><p>Facultatif et sans points. À chaque tour, tu peux dire pour qui tu vas voter et pour qui tu aimerais voter. Personne ne vérifie : tu peux répondre ce que tu veux. Les réponses du groupe ne sont dévoilées qu’une fois les résultats saisis. Elles servent au trophée du Grand Déçu.</p></section>' +

      '<section id="r-cloture"><h2>Clôture et secret des paris</h2>' +
      "<p>Chaque pari a une date d’ouverture et une date de clôture. Tant qu’il est ouvert, tu peux modifier ou retirer ton pari autant de fois que tu veux. Les paris sur les scrutins ferment à 20 h, à la fermeture des bureaux de vote.</p>" +
      "<p>Personne ne voit les paris des autres avant la clôture. À la clôture, tout est dévoilé, sauf « Mon vote », dévoilé une fois les résultats saisis.</p>" +
      "<p>Les points sont calculés quand l’admin saisit le résultat officiel. Si un résultat est corrigé, les points de tout le monde sont recalculés automatiquement.</p></section>" +

      '<section id="r-duels"><h2>Les duels</h2>' +
      "<p>Sur un pari ouvert, tu peux défier un autre joueur. Tu ne lances qu’un seul duel par pari, mais les autres peuvent te défier autant qu’ils veulent. Une fois le résultat connu, celui de vous deux qui a marqué le plus de points sur ce pari gagne le duel et " + BONUS_DUEL + " points de bonus. Le perdant ne perd rien. À points égaux, c’est un match nul, sans bonus. Si l’un de vous deux n’a pas parié, le duel est annulé et ne compte pour personne. Les duels gagnés comptent aussi pour le trophée du Duelliste.</p></section>" +

      '<section id="r-guildes"><h2>Les guildes</h2>' +
      "<p>À l’inscription, chaque joueur choisit sa guilde. Ensuite, seul l’admin du jeu peut la changer. Le classement des guildes se fait sur la moyenne des points de leurs membres : une petite guilde a autant de chances qu’une grande. Le classement général reste individuel.</p></section>" +

      '<section id="r-grades"><h2>Les grades</h2>' +
      "<p>Tes points te font monter en grade dans ta carrière politique. À chaque nouveau grade, une promotion t’attend à ta prochaine visite.</p>" +
      '<div class="defile"><table class="table-joueurs"><tbody>' + JEU.grades.map((g) => "<tr><td>" + esc(g[2]) + " <strong>" + esc(g[0]) + '</strong></td><td class="num">' + nb(g[1]) + " points</td></tr>").join("") + "</tbody></table></div>" +
      "<p>Le site fait des bruitages : un son quand tu choisis un candidat, selon son bord politique, un autre quand tu valides, une fanfare quand tu gagnes. Il peut aussi jouer une musique de fond. Le bouton en forme de haut-parleur, en haut de l’écran, règle le volume de la musique et celui des bruitages ; à zéro, ils sont coupés. Tes réglages sont gardés dans ton navigateur.</p></section>" +
      '<section id="r-trophees"><h2>Les trophées</h2><p>Remis après le second tour. Avant, le classement des trophées est provisoire. Les ex æquo reçoivent tous le trophée.</p>' +
      '<div class="defile"><table class="table-joueurs"><tbody>' + trophees.map((t) => "<tr><td><strong>" + esc(t[0]) + "</strong></td><td>" + esc(t[1]) + "</td></tr>").join("") + "</tbody></table></div></section>" +

      '<section id="r-questions"><h2>Questions fréquentes</h2>' +
      "<h3>Deux joueurs ont le même nombre de points ?</h3><p>Ils partagent le même rang.</p>" +
      "<h3>Un candidat se retire alors que j’ai parié sur lui ?</h3><p>Ton pari reste valable. S’il n’est pas sur la liste officielle, il ne peut pas finir sur le podium : la réponse rapporte 0 point.</p>" +
      "<h3>Qui fixe les probabilités ?</h3><p>L’admin du jeu saisit les intentions de vote, importées des sondages publiés et ajustées si besoin. Le jeu en déduit les probabilités de chaque pari du 1er tour en simulant 10 000 fois le scrutin, avec la marge d’erreur habituelle des sondages. Pour l’élu, il part des intentions de vote du 2nd tour. Les probabilités sont visibles par tout le monde sur chaque pari, et ne peuvent plus changer dès qu’un joueur a parié.</p>" +
      "<h3>Je peux changer de pseudo ?</h3><p>Oui, dans ton Profil. Tes paris, tes points et tes duels te suivent.</p>" +
      "<h3>Je peux changer de guilde ?</h3><p>Demande à l’admin du jeu : lui seul peut la changer. Tes points comptent alors pour ta nouvelle guilde.</p>" +
      "<h3>J’ai oublié mon mot de passe.</h3><p>Demande à l’admin du jeu : il peut le réinitialiser.</p>" +
      "<h3>Un résultat me semble faux.</h3><p>Signale-le à l’admin : il peut corriger le résultat, et les points sont recalculés.</p></section>" +

      '<section id="r-donnees"><h2>Tes données</h2>' +
      "<p>Le jeu enregistre ton email, ton pseudo, ta guilde et tes paris. L’email ne sert qu’à te connecter et n’est visible que par l’admin. Le site est hébergé par l’admin du jeu, sans publicité ni outil de suivi. « Mon vote » est facultatif.</p></section>" +
      "</div>";
    rendre(html);
    const sous = (hash || "").split("/")[2];
    if (sous) {
      const cible = document.getElementById("r-" + sous);
      if (cible) cible.scrollIntoView();
    }
  }

  // ======================================================================
  // Profil
  // ======================================================================

  async function vueProfil() {
    const res = await Promise.all([chargerEtat(), chargerClassement().catch(() => null)]);
    const e = res[0];
    const cl = res[1];
    const moi = cl ? cl.joueurs.find((j) => j.id === e.moi.id) : null;
    const duels = cl && cl.duels[e.moi.id] ? cl.duels[e.moi.id] : { gagnes: 0, perdus: 0, nuls: 0, enCours: 0 };
    const mesParis = e.paris.filter((p) => p.monProno).sort((a, b) => dms(b.cloture) - dms(a.cloture));
    const parPhase = moi ? moi.parPhase : {};
    const maxPhase = Math.max(1, Math.max.apply(null, Object.keys(PHASES).map((k) => parPhase[k] || 0)));
    let html = "<h1>" + esc(e.moi.pseudo) + "</h1>" +
      '<div class="ligne" style="margin-bottom:1.5rem">' + badgeGuilde(e.moi.guilde) + '<span class="discret petit">' + esc(e.moi.email) + "</span>" +
      (e.moi.role === "admin" ? '<span class="puce">Admin</span>' : "") + "</div>";
    if (e.moi.role === "admin") html += '<p><a class="bouton" href="#/admin">Administration du jeu</a></p>';
    html += '<div class="grille-2" style="gap:1rem"><div class="carte"><div class="gain" style="font-size:2.5rem">' + nb(moi ? moi.points : 0) + '</div><div class="discret petit">' +
      (moi ? pluriel(moi.points, "point") + ", " + moi.rang + (moi.rang === 1 ? "er" : "e") + " sur " + cl.joueurs.length : "points") + "</div></div>" +
      '<div class="carte"><div class="gain" style="font-size:2.5rem">' + duels.gagnes + "-" + duels.perdus + "-" + duels.nuls + '</div><div class="discret petit">Duels gagnés, perdus, nuls' + (duels.enCours ? ", " + duels.enCours + " en cours" : "") + "</div></div></div>";
    html += "<h2>Ta carrière politique</h2>" + echelleCarriere(moi ? moi.points : 0);
    html += "<h2>Tes points par étape</h2>" + barres(Object.keys(PHASES).map((k) => ({ label: PHASES[k], valeur: parPhase[k] || 0 })), maxPhase);
    html += "<h2>Tes paris</h2>" + (mesParis.length
      ? '<div class="defile"><table class="table-joueurs"><thead><tr><th>Pari</th><th>Ta réponse</th><th class="num">Points</th></tr></thead><tbody>' +
        mesParis.map((p) => '<tr><td><a href="#/pari/' + esc(p.id) + '">' + esc(p.titre) + "</a></td><td>" + resumeReponse(p, p.monProno.reponse) + '</td><td class="num">' +
          (p.etat === "resolu" && p.type !== "vote" ? nb(p.monProno.points) : '<span class="discret">' + (p.type === "vote" ? "sans points" : "en attente") + "</span>") + "</td></tr>").join("") +
        "</tbody></table></div>"
      : '<div class="vide"><p>Tu n’as encore parié sur rien.</p><p><a href="#/paris">Voir les paris ouverts</a></p></div>');
    html += "<h2>Changer de pseudo</h2>" +
      '<form class="carte" data-form="pseudo" novalidate>' +
      '<label class="champ"><span>Pseudo</span><input type="text" name="pseudo" value="' + esc(e.moi.pseudo) + '" minlength="2" maxlength="30" autocomplete="nickname" required><small>Entre 2 et 30 caractères. Tes paris, tes points et tes duels te suivent.</small></label>' +
      '<div class="erreur-form" aria-live="polite"></div>' +
      '<button class="bouton" type="submit">Changer le pseudo</button></form>';
    html += "<h2>Changer de mot de passe</h2>" +
      '<form class="carte" data-form="motdepasse" novalidate>' +
      '<label class="champ"><span>Mot de passe actuel</span><input type="password" name="ancien" autocomplete="current-password" required></label>' +
      '<label class="champ"><span>Nouveau mot de passe</span><input type="password" name="nouveau" minlength="10" autocomplete="new-password" required><small>10 caractères minimum.</small></label>' +
      '<div class="erreur-form" aria-live="polite"></div>' +
      '<button class="bouton" type="submit">Changer le mot de passe</button></form>' +
      '<p style="margin-top:2rem"><button type="button" class="bouton bouton-clair" data-action="deconnexion">Se déconnecter</button></p>';
    rendre(html);
  }

  // ======================================================================
  // Administration
  // ======================================================================

  async function vueAdmin(onglet, id) {
    // Si l'admin change d'onglet pendant un chargement, la réponse arrivée trop tard est ignorée.
    const jeton = S.jetonRoute;
    const e = await chargerEtat();
    if (jeton !== S.jetonRoute) return;
    if (e.moi.role !== "admin") {
      rendre('<div class="message message-erreur">Réservé à l’admin du jeu.</div>');
      return;
    }
    if (onglet === "pari") return vueEditionPari(id);
    if (onglet === "resultat") return vueResultat(id);
    const onglets = [["paris", "Paris"], ["candidats", "Candidats"], ["invitations", "Invitations"], ["joueurs", "Joueurs"]];

    let html = '<a class="retour" href="#/profil">' + ICONES.retour + "Profil</a><h1>Administration</h1>" +
      '<nav class="onglets" aria-label="Administration">' + onglets.map((o) => '<a href="#/admin/' + o[0] + '"' + (o[0] === onglet ? ' aria-current="page"' : "") + ">" + o[1] + "</a>").join("") + "</nav>";
    // L'onglet choisi s'affiche tout de suite, avant la réponse du serveur.
    if ((onglet === "candidats" && !S.tableauFrais) || onglet === "invitations" || onglet === "joueurs") rendre(html + '<p class="chargement">Chargement…</p>');
    let corps;
    if (onglet === "candidats") corps = await adminTableau();
    else if (onglet === "invitations") corps = await adminInvitations();
    else if (onglet === "joueurs") corps = await adminJoueurs(e);
    else corps = adminParis(e);
    if (jeton !== S.jetonRoute) return;
    rendre(html + corps);
    const filtreTab = app.querySelector('[data-input="tab-filtre"]');
    if (filtreTab && filtreTab.value) SAISIES["tab-filtre"](filtreTab);
  }

  function adminParis(e) {
    const liste = e.paris.slice().sort((a, b) => dms(a.cloture) - dms(b.cloture));
    const aResoudre = liste.filter((p) => p.etat === "clos");
    let html = '<div class="ligne entre" style="margin-bottom:1rem"><p class="discret" style="margin:0">Les brouillons ne sont visibles que par toi. Un pari publié apparaît aux joueurs à sa date d’ouverture.</p>' +
      '<a class="bouton" href="#/admin/pari/nouveau">Nouveau pari</a></div>';
    if (aResoudre.length) html += '<div class="message message-info">' + pluriel(aResoudre.length, "pari clos attend", "paris clos attendent") + " son résultat.</div>";
    html += '<div class="defile"><table class="admin-table"><thead><tr><th>Pari</th><th>Étape</th><th>État</th><th>Clôture</th><th>Joueurs</th><th></th></tr></thead><tbody>' +
      liste.map((p) =>
        '<tr><td><a href="#/admin/pari/' + esc(p.id) + '"><strong>' + esc(p.titre) + "</strong></a><br><small class=\"discret\">" + esc(TYPES[p.type]) + (Number(p.coef) !== 1 ? ", " + coefTxt(p.coef) : "") + "</small></td>" +
        "<td>" + esc(PHASES[p.phase]) + "</td><td>" + puceEtat(p) + "</td><td class=\"date\">" + court(dms(p.cloture)) + "</td><td>" + p.nbParieurs + "</td>" +
        '<td class="actions"><a class="bouton bouton-petit bouton-clair" href="#/admin/pari/' + esc(p.id) + '">Modifier</a> ' +
        (p.etat === "clos" || p.etat === "resolu" ? '<a class="bouton bouton-petit' + (p.etat === "clos" ? " bouton-rouge" : " bouton-clair") + '" href="#/admin/resultat/' + esc(p.id) + '">Résultat</a>' : "") + "</td></tr>"
      ).join("") + "</tbody></table></div>";
    return html;
  }

  function vueEditionPari(id) {
    const e = S.etat;
    S.calendrier = null;
    if (!S.edition || S.edition.cle !== id) {
      const p = e.paris.find((x) => x.id === id);
      if (p) {
        S.edition = { cle: id, id: p.id, titre: p.titre, description: p.description, type: p.type, phase: p.phase, ouverture: p.ouverture, cloture: p.cloture, coef: p.coef, options: copie(p.options), config: copie(p.config), statut: p.statut, nbParieurs: p.nbParieurs };
      } else {
        const demain = new Date(maintenant() + 86400000);
        S.edition = { cle: id, id: "", titre: "", description: "", type: "choix", phase: "campagne", ouverture: new Date(maintenant()).toISOString(), cloture: demain.toISOString(), coef: 1, options: [], config: {}, statut: "brouillon", nbParieurs: 0 };
      }
    }
    const ed = S.edition;
    const cfg = ed.config || {};
    const choixSelect = (champ, valeurs, actuel) => '<select data-ed="' + champ + '" data-cle="ed-' + champ + '">' + Object.keys(valeurs).map((k) => '<option value="' + k + '"' + (k === actuel ? " selected" : "") + ">" + esc(valeurs[k]) + "</option>").join("") + "</select>";
    let html = '<a class="retour" href="#/admin/paris">' + ICONES.retour + "Tous les paris</a><h1>" + (ed.id ? "Modifier le pari" : "Nouveau pari") + "</h1>";
    if (ed.nbParieurs) html += '<div class="message message-info">' + pluriel(ed.nbParieurs, "joueur a", "joueurs ont") + " déjà parié : le type, le coefficient, le barème et les probabilités ne peuvent plus changer." +
      (ed.type === "oui_non" || ed.type === "vote" ? " Tu peux encore ajouter des noms tant que le pari est ouvert." : " Tu ne peux plus ajouter de réponse.") +
      " Le titre, la description et les libellés restent modifiables.</div>";
    const lien = cfg.lien || "";
    html += '<fieldset><legend>Le pari</legend>' +
      '<label class="champ"><span>Relié au tableau des candidats</span>' +
      (ed.nbParieurs ? '<input type="text" value="' + esc(lien ? LIENS[lien][0] : "Non relié") + '" disabled>' :
        '<select data-ed="lien" data-cle="ed-lien"><option value="">Non relié : réponses et cotes saisies à la main</option>' +
        Object.keys(LIENS).map((k) => '<option value="' + k + '"' + (k === lien ? " selected" : "") + ">" + esc(LIENS[k][0]) + " (" + esc(TYPES[LIENS[k][1]]) + ")</option>").join("") + "</select>") +
      "<small>" + (lien ? "Les réponses, les cotes et le résultat viennent du tableau des candidats." : "Un pari relié se remplit tout seul depuis le tableau des candidats.") + "</small></label>" +
      '<label class="champ"><span>Titre</span><input type="text" maxlength="150" value="' + esc(ed.titre) + '" data-ed="titre" data-cle="ed-titre"></label>' +
      '<label class="champ"><span>Description</span><textarea maxlength="2000" data-ed="description" data-cle="ed-description">' + esc(ed.description) + "</textarea><small>Ce que les joueurs doivent savoir pour parier : la question précise, la source du résultat.</small></label>" +
      '<div class="grille-2"><label class="champ"><span>Type</span>' + (ed.nbParieurs || lien ? '<input type="text" value="' + esc(TYPES[ed.type]) + '" disabled>' : choixSelect("type", TYPES, ed.type)) + "</label>" +
      '<label class="champ"><span>Étape</span>' + choixSelect("phase", PHASES, ed.phase) + "</label>" +
      champDate("ouverture", "Ouverture", ed.ouverture, "") +
      champDate("cloture", "Clôture", ed.cloture, "Pour un scrutin : 20:00 le jour du vote.") +
      '<label class="champ"><span>Coefficient</span><input type="number" step="0.1" min="0.1" max="10" value="' + esc(ed.coef) + '" data-ed="coef" data-cle="ed-coef"><small>1 = normal, 2 = compte double, 0,2 = cinq fois moins.</small></label>' +
      '<div class="champ"><span>Statut</span><div class="radios" style="min-height:2.75rem">' +
      (ed.statut === "resolu" ? "<span>Résultat saisi</span>" :
        '<label><input type="radio" name="statut" value="brouillon" data-ed="statut"' + (ed.statut === "brouillon" ? " checked" : "") + "> Brouillon</label>" +
        '<label><input type="radio" name="statut" value="publie" data-ed="statut"' + (ed.statut === "publie" ? " checked" : "") + "> Publié</label>") +
      "</div></div></div></fieldset>";

    if (ed.type === "estimation") {
      html += '<fieldset><legend>Réglages de l’estimation</legend><div class="grille-2">' +
        '<label class="champ"><span>Unité affichée</span><input type="text" maxlength="20" value="' + esc(cfg.unite || "") + '" data-edcfg="unite"></label>' +
        '<label class="champ"><span>Points perdus par unité d’écart</span><input type="number" step="0.5" min="0.5" value="' + esc(cfg.pente || 10) + '" data-edcfg="pente"></label>' +
        '<label class="champ"><span>Décimales acceptées</span><input type="number" min="0" max="2" value="' + esc(cfg.decimales || 0) + '" data-edcfg="decimales"></label><span></span>' +
        '<label class="champ"><span>Minimum</span><input type="number" value="' + esc(cfg.min !== undefined ? cfg.min : "") + '" data-edcfg="min"></label>' +
        '<label class="champ"><span>Maximum</span><input type="number" value="' + esc(cfg.max !== undefined ? cfg.max : "") + '" data-edcfg="max"></label>' +
        "</div></fieldset>";
    } else {
      if (ed.type === "scores") {
        html += '<fieldset><legend>Réglages des scores</legend><div class="grille-2">' +
          '<label class="champ"><span>Points perdus par point d’écart</span><input type="number" step="0.5" min="0.5" value="' + esc(cfg.pente || 10) + '" data-edcfg="pente"><small>Pour chaque candidat, on part de 100 points. Le joueur gagne la moyenne.</small></label>' +
          "</div></fieldset>";
      }
      if (ed.type === "classement") {
        html += '<fieldset><legend>Réglages du classement</legend><div class="grille-2">' +
          '<label class="champ"><span>Nombre de places</span><input type="number" min="1" max="5" value="' + esc(cfg.places || 3) + '" data-edcfg="places"></label>' +
          '<label class="champ"><span>Sens</span><select data-edcfg="sens"><option value="haut"' + (cfg.sens !== "bas" ? " selected" : "") + '>Les premiers (podium)</option><option value="bas"' + (cfg.sens === "bas" ? " selected" : "") + ">Les derniers (flop)</option></select></label></div></fieldset>";
      }
      html += lien && LIENS[lien] ? optionsReliees(ed) : editeurOptions(ed, e);
    }
    html += '<div class="action-pari">' +
      (ed.id && !ed.nbParieurs ? '<button type="button" class="bouton-lien" data-action="supprimer-pari">Supprimer ce pari</button>' : "<span></span>") +
      '<button type="button" class="bouton bouton-rouge" data-action="enregistrer-pari">Enregistrer</button></div>';
    rendre(html);
  }

  // ---------- Dates au format français : jj/mm/aaaa et hh:mm sur 24 heures ----------
  // Le champ natif « datetime-local » suit la langue du navigateur (mois/jour/année et AM/PM en anglais) :
  // on le remplace par deux champs texte et un petit calendrier.

  const MOIS_ANNEE = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
  function z2(n) { return String(n).padStart(2, "0"); }

  function lireDateFr(jourTxt, heureTxt) {
    const j = String(jourTxt || "").trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/);
    const ht = String(heureTxt || "").trim();
    const h = ht.match(/^(\d{1,2})\s*(?:[:hH.]\s*(\d{2})?)?$/) || ht.match(/^(\d{2})(\d{2})$/);
    if (!j || !h) return 0;
    const jour = Number(j[1]);
    const mois = Number(j[2]);
    const annee = j[3].length === 2 ? 2000 + Number(j[3]) : Number(j[3]);
    const heure = Number(h[1]);
    const minute = h[2] ? Number(h[2]) : 0;
    if (heure > 23 || minute > 59) return 0;
    const d = new Date(annee, mois - 1, jour, heure, minute);
    if (d.getFullYear() !== annee || d.getMonth() !== mois - 1 || d.getDate() !== jour) return 0;
    return d.getTime();
  }

  function champDate(k, titre, iso, aide) {
    const ms = dms(iso);
    const d = ms ? new Date(ms) : null;
    const jour = d ? z2(d.getDate()) + "/" + z2(d.getMonth() + 1) + "/" + d.getFullYear() : "";
    const heure = d ? z2(d.getHours()) + ":" + z2(d.getMinutes()) : "";
    const invalide = S.edition && S.edition.datesInvalides && S.edition.datesInvalides[k];
    return '<div class="champ"><span>' + esc(titre) + '</span><div class="champ-date' + (invalide ? " invalide" : "") + '" data-champ-date="' + k + '">' +
      '<input type="text" inputmode="numeric" autocomplete="off" placeholder="jj/mm/aaaa" maxlength="10" value="' + jour + '" data-date="jour" data-champ="' + k + '" data-cle="ed-' + k + '-jour" aria-label="' + esc(titre) + ', date au format jour/mois/année">' +
      '<button type="button" class="bouton-calendrier" data-action="ouvrir-calendrier" data-champ="' + k + '" aria-label="Choisir la date dans le calendrier" aria-expanded="false">' + ICONES.calendrier + "</button>" +
      '<input type="text" inputmode="numeric" autocomplete="off" placeholder="hh:mm" maxlength="5" value="' + heure + '" data-date="heure" data-champ="' + k + '" data-cle="ed-' + k + '-heure" aria-label="' + esc(titre) + ', heure sur 24 heures">' +
      '<div class="calendrier" hidden></div></div>' +
      '<small class="date-erreur"' + (invalide ? "" : " hidden") + ">Date ou heure non valide. Exemple : 18/04/2027 et 20:00.</small>" +
      (aide ? "<small>" + esc(aide) + "</small>" : "") + "</div>";
  }

  // final : à la sortie du champ. On ne signale une erreur qu'à ce moment, pas pendant la frappe.
  function saisieDate(el, final) {
    const ed = S.edition;
    if (!ed) return;
    const k = el.dataset.champ;
    const cont = el.closest("[data-champ-date]");
    const champJour = cont.querySelector('[data-date="jour"]');
    const champHeure = cont.querySelector('[data-date="heure"]');
    const ms = lireDateFr(champJour.value, champHeure.value);
    ed.datesInvalides = ed.datesInvalides || {};
    if (ms) {
      ed[k] = new Date(ms).toISOString();
      ed.datesInvalides[k] = false;
      if (final) {
        const d = new Date(ms);
        champJour.value = z2(d.getDate()) + "/" + z2(d.getMonth() + 1) + "/" + d.getFullYear();
        champHeure.value = z2(d.getHours()) + ":" + z2(d.getMinutes());
      }
    } else {
      ed.datesInvalides[k] = true;
    }
    if (final || ms) {
      cont.classList.toggle("invalide", !ms);
      const msg = cont.parentNode.querySelector(".date-erreur");
      if (msg) msg.hidden = !!ms;
    }
  }

  function dessinerCalendrier() {
    const c = S.calendrier;
    app.querySelectorAll(".calendrier").forEach((x) => { x.hidden = true; x.innerHTML = ""; });
    app.querySelectorAll(".bouton-calendrier").forEach((b) => b.setAttribute("aria-expanded", "false"));
    if (!c) return;
    const cont = app.querySelector('[data-champ-date="' + c.champ + '"]');
    if (!cont) { S.calendrier = null; return; }
    const ms = dms(S.edition && S.edition[c.champ]);
    const choisi = ms ? new Date(ms) : null;
    const auj = new Date(maintenant());
    const premier = new Date(c.annee, c.mois, 1);
    const decalage = (premier.getDay() + 6) % 7;
    const nbJours = new Date(c.annee, c.mois + 1, 0).getDate();
    const memeJour = (d, a, m, j) => d && d.getFullYear() === a && d.getMonth() === m && d.getDate() === j;
    let grille = ["lu", "ma", "me", "je", "ve", "sa", "di"].map((x) => '<span class="cal-jsem">' + x + "</span>").join("");
    for (let i = 0; i < decalage; i++) grille += "<span></span>";
    for (let j = 1; j <= nbJours; j++) {
      const classes = (memeJour(choisi, c.annee, c.mois, j) ? " choisi" : "") + (memeJour(auj, c.annee, c.mois, j) ? " aujourdhui" : "");
      grille += '<button type="button" class="cal-jour' + classes + '" data-action="cal-jour" data-jour="' + z2(j) + "/" + z2(c.mois + 1) + "/" + c.annee + '"' +
        (memeJour(choisi, c.annee, c.mois, j) ? ' aria-current="date"' : "") + ">" + j + "</button>";
    }
    const cal = cont.querySelector(".calendrier");
    cal.innerHTML = '<div class="cal-entete"><button type="button" class="cal-nav" data-action="cal-mois" data-delta="-1" aria-label="Mois précédent">‹</button>' +
      "<strong>" + esc(MOIS_ANNEE.format(premier)) + '</strong><button type="button" class="cal-nav" data-action="cal-mois" data-delta="1" aria-label="Mois suivant">›</button></div>' +
      '<div class="cal-grille">' + grille + "</div>" +
      '<div class="cal-pied"><button type="button" class="bouton-lien" data-action="cal-jour" data-jour="' + z2(auj.getDate()) + "/" + z2(auj.getMonth() + 1) + "/" + auj.getFullYear() + '">Aujourd’hui</button>' +
      '<button type="button" class="bouton-lien" data-action="cal-mois" data-delta="-12">Année précédente</button><button type="button" class="bouton-lien" data-action="cal-mois" data-delta="12">Année suivante</button></div>';
    cal.hidden = false;
    cont.querySelector(".bouton-calendrier").setAttribute("aria-expanded", "true");
  }

  function fermerCalendrier() {
    S.calendrier = null;
    dessinerCalendrier();
  }

  // ---------- Paris reliés au tableau des candidats ----------

  function configParDefaut(type, lien) {
    let c = {};
    if (type === "estimation") c = { unite: "%", pente: 10, decimales: 1, min: 0, max: 100 };
    if (type === "classement") c = { places: 3, sens: lien === "flop_t1" ? "bas" : "haut" };
    if (type === "scores") c = { unite: "%", pente: 10 };
    if (lien === "nb_officiels") c = { unite: "candidats", pente: 20, decimales: 0, min: 0, max: 60 };
    if (lien === "blanc_t1" || lien === "blanc_t2") c.pente = 20;
    if (lien === "blanc_t1" || lien === "blanc_t2") c.max = 30;
    if (lien === "score_vainqueur_t2") c.min = 50;
    if (lien) c.lien = lien;
    return c;
  }

  function optionsReliees(ed) {
    const lien = ed.config.lien;
    const avecPct = ed.type === "choix" || ed.type === "oui_non" || ed.type === "classement";
    let html = "<fieldset><legend>Réponses possibles (" + ed.options.length + ")</legend>" +
      '<p class="discret petit">Elles viennent du <a href="#/admin/candidats">tableau des candidats</a>' + (avecPct ? ", avec leurs cotes" : "") +
      ". Elles sont remises à jour à chaque enregistrement du tableau ou de ce pari, tant que personne n’a parié." +
      (ed.type === "oui_non" || ed.type === "vote" ? " Ensuite, seuls les nouveaux noms sont ajoutés, jusqu’à la clôture." : " Ensuite, elles sont figées.") + "</p>";
    if (!ed.options.length) {
      html += '<p class="discret">' + (lien === "elu" || lien === "scores_t2" || lien === "vote_t2"
        ? "Les deux finalistes apparaîtront dès que les scores du 1er tour seront saisis dans le tableau."
        : "Les réponses apparaîtront à l’enregistrement.") + "</p>";
    } else {
      html += '<div class="defile"><table class="admin-table"><thead><tr><th>Réponse</th>' + (avecPct ? '<th class="num">Cote</th><th>Gain</th>' : "") + "</tr></thead><tbody>" +
        ed.options.map((o) => "<tr><td>" + esc(o.label) + "</td>" +
          (avecPct ? '<td class="num">' + (o.pct === null || o.pct === undefined ? '<span class="discret">à compléter</span>' : pctTxt(o.pct)) + '</td><td><span class="gain-apercu">' + apercuGain(ed, o.pct) + "</span></td>" : "") + "</tr>").join("") +
        "</tbody></table></div>";
    }
    return html + "</fieldset>";
  }

  // ---------- Tableau des candidats ----------

  function texteBilan(b) {
    if (!b) return "";
    const morceaux = [];
    if (b.majs) morceaux.push(pluriel(b.majs, "pari mis à jour", "paris mis à jour"));
    if (b.resolus) morceaux.push(pluriel(b.resolus, "pari résolu", "paris résolus"));
    if (b.corriges) morceaux.push(pluriel(b.corriges, "résultat corrigé", "résultats corrigés"));
    return morceaux.length ? morceaux.join(", ") + "." : "Aucun pari à mettre à jour.";
  }

  function rangTxt(n) { return n === 1 ? "1er" : n + "e"; }

  function ligneCandidat(c, nouveau) {
    const val = (v) => (v === null || v === undefined ? "" : v);
    const num = (k, min, max, titre) => '<td class="pct"><input type="number" inputmode="decimal" step="0.1" min="' + min + '" max="' + max + '" value="' + esc(val(c[k])) + '" data-tab="' + k + '" data-input="tab-num" aria-label="' + esc(titre + (c.nom ? " de " + c.nom : "")) + '"></td>';
    const courts = { declare: "Déclaré", pressenti: "Pressenti", officiel: "Officiel", non_retenu: "Non retenu", retire: "Retiré" };
    const statut = '<select data-tab="statut" aria-label="Statut' + esc(c.nom ? " de " + c.nom : "") + '">' + Object.keys(courts).map((k) => '<option value="' + k + '"' + (k === c.statut ? " selected" : "") + ">" + courts[k] + "</option>").join("") + "</select>";
    const bord = '<select data-tab="bord" aria-label="Bord politique' + esc(c.nom ? " de " + c.nom : "") + '"><option value="">Non renseigné</option>' + Object.keys(BORDS).map((k) => '<option value="' + k + '"' + (k === c.bord ? " selected" : "") + ">" + BORDS[k] + "</option>").join("") + "</select>";
    return '<tr data-ligne-cand="' + esc(c.id || "") + '" data-nom-cand="' + esc(c.nom || "") + '" class="statut-' + esc(c.statut) + (nouveau ? " nouveau" : "") + '">' +
      '<td><input type="text" value="' + esc(c.nom || "") + '" data-tab="nom" maxlength="80" aria-label="Nom" placeholder="Nom du candidat"></td>' +
      '<td><input type="text" value="' + esc(c.parti || "") + '" data-tab="parti" maxlength="120" aria-label="Parti' + esc(c.nom ? " de " + c.nom : "") + '"></td>' +
      "<td>" + statut + "</td><td>" + bord + "</td>" +
      num("cote_parrainages", 1, 99, "Cote des 500 signatures") + num("intention_t1", 0, 100, "Intention de vote au 1er tour") +
      num("intention_t2", 0, 100, "Intention de vote au 2nd tour") + num("score_t1", 0, 100, "Score au 1er tour") + num("score_t2", 0, 100, "Score au 2nd tour") +
      '<td class="actions"><button type="button" class="bouton-lien" data-action="supprimer-candidat">Supprimer</button></td></tr>';
  }

  async function adminTableau() {
    const t = S.tableauFrais && S.tableau ? S.tableau : await api("/api/jeu/admin/tableau");
    S.tableau = t;
    S.tableauFrais = false;
    const sc = t.scrutin || {};
    const cotes = t.cotes || {};
    const parIdC = parId(t.candidats);
    const ordreStatut = { officiel: 0, declare: 1, pressenti: 2, non_retenu: 3, retire: 4 };
    const liste = t.candidats.slice().sort((a, b) =>
      (ordreStatut[a.statut] - ordreStatut[b.statut]) ||
      ((b.intention_t1 === null ? -1 : b.intention_t1) - (a.intention_t1 === null ? -1 : a.intention_t1)) ||
      a.nom.localeCompare(b.nom));
    const val = (v) => (v === null || v === undefined ? "" : v);
    const somme = (k) => Math.round(t.candidats.reduce((s, c) => s + (c[k] === null ? 0 : c[k]), 0) * 10) / 10;

    let html = '<p class="discret">Un seul tableau pour tout le scrutin. Les paris reliés y prennent leurs réponses, leurs cotes et leur résultat. ' +
      "Les cotes d’un pari sont figées dès qu’un premier joueur a parié dessus.</p>";

    // Étapes
    const etape = (k, titre, aide) => '<label class="etape-scrutin"><input type="checkbox" data-etape="' + k + '"' + (sc[k] ? " checked" : "") + "><span><strong>" + titre + "</strong><small>" + aide + "</small></span></label>";
    html += '<fieldset><legend>Avancement du scrutin</legend>' +
      etape("liste_officielle", "La liste officielle est publiée", "Les candidats au statut « Officiel » ont leurs 500 signatures. Résout les paris des parrainages.") +
      etape("resultats_t1", "Les résultats du 1er tour sont définitifs", "Résout les paris du 1er tour d’après les scores, le vote blanc et l’abstention.") +
      etape("resultats_t2", "Les résultats du 2nd tour sont définitifs", "Résout les paris du 2nd tour.") +
      '<p class="petit discret" style="margin:0">Un pari n’est résolu qu’après sa clôture. Si tu corriges un score ensuite, les points sont recalculés.</p></fieldset>';

    // Candidats
    const finalistes = (cotes.finalistes || []).map((id) => (parIdC[id] || {}).nom).filter(Boolean);
    html += '<div class="ligne entre" style="margin:1.5rem 0 .75rem"><h2 style="margin:0">Candidats</h2>' +
      '<div class="ligne"><input type="search" placeholder="Chercher un nom" aria-label="Chercher un candidat" data-input="tab-filtre" value="' + esc(S.filtreTableau || "") + '" style="max-width:16rem">' +
      '<button type="button" class="bouton bouton-petit bouton-clair" data-action="ajouter-ligne">Ajouter un candidat</button></div></div>' +
      '<p class="petit discret">' + (finalistes.length === 2
        ? "Qualifiés pour le 2nd tour, d’après les scores du 1er tour : " + esc(finalistes[0]) + " et " + esc(finalistes[1]) + "."
        : "Les deux qualifiés pour le 2nd tour seront les deux meilleurs scores du 1er tour.") +
      " Le bord politique sert aux sons joués quand un joueur choisit ce candidat.</p>" +
      '<div class="defile"><table class="admin-table tableau-candidats"><thead><tr>' +
      "<th>Candidat</th><th>Parti</th><th>Statut</th><th>Bord</th>" +
      '<th class="num">Cote 500 sig.</th><th class="num">Intentions T1</th><th class="num">Intentions T2</th><th class="num">Score T1</th><th class="num">Score T2</th><th></th>' +
      "</tr></thead><tbody>" + liste.map((c) => ligneCandidat(c, false)).join("") +
      '</tbody><tfoot><tr><th colspan="5">Total</th>' +
      ["intention_t1", "intention_t2", "score_t1", "score_t2"].map((k) => '<th class="num" data-total="' + k + '">' + pctTxt(somme(k)) + "</th>").join("") + "<th></th></tr></tfoot></table></div>";

    // Hors candidats
    const champScrutin = (tour, k, titre) => '<td class="pct"><input type="number" inputmode="decimal" step="0.01" min="0" max="100" value="' + esc(val((sc[tour] || {})[k])) + '" data-scrutin="' + tour + "." + k + '" aria-label="' + esc(titre) + '"></td>';
    html += '<div class="defile" style="margin-top:1rem"><table class="admin-table" style="max-width:34rem"><thead><tr><th>Hors candidats</th><th class="num">1er tour</th><th class="num">2nd tour</th></tr></thead><tbody>' +
      "<tr><td>Vote blanc, en % des votants</td>" + champScrutin("t1", "blanc", "Vote blanc au 1er tour") + champScrutin("t2", "blanc", "Vote blanc au 2nd tour") + "</tr>" +
      "<tr><td>Abstention, en % des inscrits</td>" + champScrutin("t1", "abstention", "Abstention au 1er tour") + champScrutin("t2", "abstention", "Abstention au 2nd tour") + "</tr>" +
      "</tbody></table></div>";

    html += '<div class="action-pari"><span class="petit discret">Les cotes 500 signatures vont de 1 à 99 %. Les intentions et les scores sont en % des suffrages exprimés. Ajouts et suppressions sont appliqués à l’enregistrement.</span>' +
      '<button type="button" class="bouton bouton-rouge" data-action="enregistrer-tableau">Enregistrer le tableau</button></div>';

    // Cotes calculées
    const ids = (cotes.candidatsT1 || []);
    const c1 = (m, id) => (m && m[id] !== undefined ? pctTxt(m[id]) : "");
    html += '<h2>Cotes calculées</h2><p class="petit discret">Pour les paris du 1er tour, le jeu simule 10 000 fois le scrutin à partir des intentions de vote, avec une marge d’erreur d’environ 4 points pour un candidat à 30 % et d’1 point pour un candidat à 4 %. ' +
      "Un candidat sans intention de vote compte pour 0,5 %. Une cote ne descend jamais sous 1 % ni ne dépasse 99 %. " +
      "Pour l’élu, la cote vient de l’écart entre les deux finalistes dans les intentions du 2nd tour. Les candidats du 1er tour sont ceux de la liste officielle, ou à défaut les déclarés. Ce tableau se met à jour à l’enregistrement.</p>" +
      (ids.length ? '<div class="defile"><table class="admin-table"><thead><tr><th>Candidat</th><th class="num">En tête</th><th class="num">Qualifié</th><th class="num">Podium</th><th class="num">Flop 3</th><th class="num">Dernier</th><th class="num">Élu</th></tr></thead><tbody>' +
        ids.slice().sort((a, b) => ((parIdC[b] || {}).intention_t1 || 0) - ((parIdC[a] || {}).intention_t1 || 0)).map((id) =>
          "<tr><td>" + esc((parIdC[id] || {}).nom || "") + '</td><td class="num">' + c1(cotes.premier, id) + '</td><td class="num">' + c1(cotes.qualifie, id) + '</td><td class="num">' + c1(cotes.podium, id) +
          '</td><td class="num">' + c1(cotes.flop, id) + '</td><td class="num">' + c1(cotes.dernier, id) + '</td><td class="num">' + c1(cotes.elu, id) + "</td></tr>").join("") +
        "</tbody></table></div>" : '<p class="discret">Aucun candidat déclaré ou officiel.</p>');

    // Paris reliés
    html += "<h2>Paris reliés au tableau</h2>" + (t.paris.length
      ? '<div class="defile"><table class="admin-table"><thead><tr><th>Pari</th><th>Relié à</th><th>Statut</th><th class="num">Réponses</th><th class="num">Joueurs</th></tr></thead><tbody>' +
        t.paris.map((p) => '<tr><td><a href="#/admin/pari/' + esc(p.id) + '">' + esc(p.titre) + "</a></td><td>" + esc((t.liens[p.lien] || {}).nom || p.lien) + "</td><td>" +
          esc({ brouillon: "Brouillon", publie: "Publié", resolu: "Résolu" }[p.statut] || p.statut) + '</td><td class="num">' + (p.nbOptions || "") + '</td><td class="num">' + p.nbPronos + (p.nbPronos ? ' <small class="discret">cotes figées</small>' : "") + "</td></tr>").join("") +
        "</tbody></table></div>"
      : '<p class="discret">Aucun pari relié. Dans un pari, choisis « Relié au tableau des candidats ».</p>');

    // Imports : en bas, car ils ne servent qu'à l'occasion.
    const so = sc.sondage;
    html += '<div class="carte carte-import" style="margin-top:1.5rem"><h3 style="margin-top:0">Imports</h3>' +
      '<p class="petit discret">Source : <a href="https://github.com/2027etmoi/2027etmoi" target="_blank" rel="noopener">2027 et moi</a>, données ouvertes (Licence ouverte) qui reprennent les notices de la Commission des sondages et des déclarations de candidature sourcées. Il n’existe pas de liste officielle avant celle du Conseil constitutionnel, attendue mi-mars 2027. Pense à enregistrer le tableau avant un import : un import recharge le tableau.</p>' +

      '<h4>1. Candidats</h4><p class="petit">Ajoute les candidats déclarés et pressentis absents du tableau, avec leur parti et leur bord. Passe en « Retiré » ceux qui ont renoncé. Ne touche pas aux candidats « Officiel » ou « Non retenu », ni aux candidats absents de la source.</p>' +
      (S.rapportCandidats ? rapportCandidats(S.rapportCandidats) : "") +
      '<button type="button" class="bouton bouton-clair" data-action="importer-candidats">Importer les candidats</button>' +

      '<h4>2. Intentions de vote</h4><p class="petit">Moyenne des sondages du 1er tour des dernières semaines : pour chaque candidat, la moyenne des hypothèses de chaque sondage, puis la moyenne des sondages. Renseigne aussi le bord des candidats qui n’en ont pas.</p>' +
      (so ? '<p class="petit discret">Dernier import le ' + esc(jour(dms(so.importe_le))) + " : " + pluriel(so.nb || 0, "sondage") + (so.du ? " réalisés du " + esc(jour(dms(so.du))) + " au " + esc(jour(dms(so.au))) : "") + ", données mises à jour le " + esc(jour(dms(so.mise_a_jour))) + ".</p>" : "") +
      (S.rapportImport ? rapportImport(S.rapportImport) : "") +
      '<button type="button" class="bouton bouton-clair" data-action="importer-sondages">Importer les intentions de vote</button>' +
      '<p class="petit discret">Les sondages du 2nd tour testent des duels hypothétiques : les intentions du 2nd tour se saisissent à la main, une fois les finalistes connus.</p>' +

      '<h4>3. Cotes des 500 signatures</h4><p class="petit">Il n’existe pas de pronostic publié des parrainages : la cote est estimée par une règle tirée des présidentielles 2017 et 2022, appliquée aux candidats déclarés et pressentis. À faire après l’import des intentions de vote, puis à ajuster à la main.</p>' +
      '<ul class="petit"><li>Intention de vote de 5 % ou plus : 95 %. De 2 à 5 % : 80 %. De 1 à 2 % : 60 %. Moins de 1 % : 40 %. Absent des sondages : 10 %.</li>' +
      "<li>Qualifié à sa dernière présidentielle : au moins 85 %.</li>" +
      "<li>Non qualifié à sa dernière présidentielle : au plus 50 % s’il avait réuni 200 parrainages ou plus, au plus 20 % sinon.</li></ul>" +
      (S.rapportCotes ? rapportCotes(S.rapportCotes) : "") +
      '<button type="button" class="bouton bouton-clair" data-action="cotes-parrainages">Calculer les cotes des 500 signatures</button>' +
      '<p class="petit discret" style="margin-bottom:0">Les cotes du pari des 500 signatures sont figées dès le premier pari d’un joueur : à régler avant de le publier. Pendant la collecte, le Conseil constitutionnel publie les parrainages validés deux fois par semaine ; ils servent à suivre la course, pas à changer les cotes.</p></div>';
    S.rapportCandidats = null;
    S.rapportCotes = null;
    S.rapportImport = null;
    return html;
  }

  function rapportCandidats(r) {
    const lignes = [];
    lignes.push(r.ajoutes.length ? pluriel(r.ajoutes.length, "candidat ajouté", "candidats ajoutés") + " : " + r.ajoutes.join(", ") + "." : "Aucun candidat à ajouter.");
    if (r.retires.length) lignes.push("Passés en « Retiré » : " + r.retires.join(", ") + ".");
    if (r.statuts.length) lignes.push("Statut mis à jour : " + r.statuts.join(", ") + ".");
    if (r.absents.length) lignes.push("Déclarés ou pressentis dans le tableau mais absents de la source, non modifiés : " + r.absents.join(", ") + ".");
    if (r.mise_a_jour) lignes.push("Source mise à jour le " + jour(dms(r.mise_a_jour)) + ".");
    return '<div class="message message-info petit">' + lignes.map(esc).join("<br>") + "</div>";
  }

  function rapportCotes(r) {
    return '<div class="message message-info petit">' + (r.sansHistorique ? "Historique des candidatures indisponible : cotes calculées sur les seuls sondages.<br>" : "") +
      r.lignes.map((l) => "<strong>" + esc(l.nom) + "</strong> : " + l.cote + " % <span class=\"discret\">(" + esc(l.raison) + ")</span>").join("<br>") + "</div>";
  }

  function rapportImport(r) {
    const lignes = [];
    lignes.push(pluriel(r.trouves.length, "candidat mis à jour", "candidats mis à jour") + ".");
    if (r.horsTableau.length) lignes.push("Dans les sondages mais pas dans le tableau, donc ignorés : " + r.horsTableau.join(", ") + ".");
    if (r.sansSondage.length) lignes.push("Déclarés ou officiels mais absents des sondages, intention inchangée : " + r.sansSondage.join(", ") + ".");
    if (r.bordsAjoutes) lignes.push(pluriel(r.bordsAjoutes, "bord politique renseigné", "bords politiques renseignés") + ".");
    return '<div class="message message-info petit">' + lignes.map(esc).join("<br>") + "</div>";
  }

  function lireTableau() {
    const lignes = Array.prototype.slice.call(app.querySelectorAll("[data-ligne-cand]"));
    const supprimes = lignes.filter((tr) => tr.classList.contains("a-supprimer") && tr.dataset.ligneCand).map((tr) => tr.dataset.ligneCand);
    const candidats = lignes.filter((tr) => !tr.classList.contains("a-supprimer") && (tr.dataset.ligneCand || tr.querySelector('[data-tab="nom"]').value.trim())).map((tr) => {
      const v = (k) => tr.querySelector('[data-tab="' + k + '"]').value;
      return {
        id: tr.dataset.ligneCand, nom: v("nom"), parti: v("parti"), statut: v("statut"), bord: v("bord"),
        cote_parrainages: v("cote_parrainages"), intention_t1: v("intention_t1"), intention_t2: v("intention_t2"), score_t1: v("score_t1"), score_t2: v("score_t2"),
      };
    });
    const scrutin = { t1: {}, t2: {} };
    app.querySelectorAll("[data-etape]").forEach((c) => { scrutin[c.dataset.etape] = c.checked; });
    app.querySelectorAll("[data-scrutin]").forEach((i) => {
      const k = i.dataset.scrutin.split(".");
      scrutin[k[0]][k[1]] = i.value;
    });
    return { candidats: candidats, supprimes: supprimes, scrutin: scrutin };
  }

  function majTotauxTableau() {
    ["intention_t1", "intention_t2", "score_t1", "score_t2"].forEach((k) => {
      let s = 0;
      app.querySelectorAll('[data-tab="' + k + '"]').forEach((i) => {
        const v = Number(String(i.value).replace(",", "."));
        if (i.value !== "" && isFinite(v)) s += v;
      });
      const cell = app.querySelector('[data-total="' + k + '"]');
      if (cell) cell.textContent = pctTxt(Math.round(s * 10) / 10);
    });
  }

  function aidePct(type) {
    if (type === "oui_non") return "Probabilité du oui, de 1 à 99 %.";
    if (type === "classement") return "Probabilité que le nom figure dans ce classement, de 1 à 99 %.";
    if (type === "choix") return "Probabilité que ce soit la bonne réponse, de 1 à 99 %. Le total peut dépasser ou ne pas atteindre 100 %.";
    return "";
  }

  function apercuGain(ed, pct) {
    if (pct === null || pct === undefined || pct === "") return "";
    const p = Number(String(pct).replace(",", "."));
    if (!isFinite(p) || p < 1 || p > 99) return "hors limites";
    const c = Number(String(ed.coef).replace(",", ".")) || 1;
    if (ed.type === "oui_non") return "oui +" + Math.round(pointsProba(p) * c) + ", non +" + Math.round(pointsProba(100 - p) * c);
    if (ed.type === "classement") return "+" + Math.round(pointsProba(p) * c) + " ou +" + Math.round(Math.round(pointsProba(p) / 2) * c);
    return "+" + Math.round(pointsProba(p) * c) + " points";
  }

  function editeurOptions(ed, e) {
    const avecPct = ed.type !== "vote" && ed.type !== "scores";
    const dejaLa = {};
    ed.options.forEach((o) => { dejaLa[o.id] = true; });
    const candidatsLibres = e.candidats.filter((c) => !dejaLa[c.id]);
    let html = "<fieldset><legend>Réponses possibles (" + ed.options.length + ")</legend>" +
      (avecPct ? '<p class="discret petit">' + aidePct(ed.type) + "</p>" : "") +
      '<div class="ligne" style="margin-bottom:.75rem">' +
      '<button type="button" class="bouton bouton-petit bouton-clair" data-action="ajouter-candidats" data-filtre="actifs">Ajouter les candidats déclarés et officiels</button>' +
      '<button type="button" class="bouton bouton-petit bouton-clair" data-action="ajouter-candidats" data-filtre="officiels">Ajouter les officiels seulement</button>' +
      (ed.options.length ? '<button type="button" class="bouton-lien" data-action="vider-options">Tout retirer</button>' : "") + "</div>";
    if (ed.options.length) {
      html += '<div class="defile"><table class="admin-table"><thead><tr><th>Réponse</th>' + (avecPct ? '<th>Probabilité</th><th>Gain</th>' : "") + "<th></th></tr></thead><tbody>" +
        ed.options.map((o, i) =>
          '<tr><td><input type="text" value="' + esc(o.label) + '" data-edopt="label" data-i="' + i + '" data-cle="opt-l-' + i + '"' + (o.id && o.id.indexOf("x_") !== 0 && o.id ? ' title="Candidat : renommer depuis l’onglet Candidats"' : "") + "></td>" +
          (avecPct ? '<td class="pct"><input type="number" min="1" max="99" step="0.5" value="' + esc(o.pct === null || o.pct === undefined ? "" : o.pct) + '" data-edopt="pct" data-i="' + i + '" data-cle="opt-p-' + i + '" aria-label="Probabilité de ' + esc(o.label) + '"></td><td><span class="gain-apercu" id="apercu-' + i + '">' + apercuGain(ed, o.pct) + "</span></td>" : "") +
          '<td class="actions"><button type="button" class="bouton bouton-petit bouton-clair" data-action="retirer-option" data-i="' + i + '" aria-label="Retirer ' + esc(o.label) + '">Retirer</button></td></tr>'
        ).join("") + "</tbody></table></div>";
    } else {
      html += '<p class="discret">Aucune réponse pour l’instant.</p>';
    }
    html += '<div class="grille-2" style="margin-top:1rem"><div class="champ"><span>Ajouter un candidat</span><div class="ligne" style="flex-wrap:nowrap"><select id="ajout-candidat">' +
      candidatsLibres.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.nom) + " (" + esc(STATUTS_CANDIDAT[c.statut]) + ")</option>").join("") +
      '</select><button type="button" class="bouton bouton-petit" data-action="ajouter-candidat"' + (candidatsLibres.length ? "" : " disabled") + ">Ajouter</button></div></div>" +
      '<div class="champ"><span>Ajouter une autre réponse</span><div class="ligne" style="flex-wrap:nowrap"><input type="text" id="ajout-libre" placeholder="Vote blanc, Abstention…" maxlength="80">' +
      '<button type="button" class="bouton bouton-petit" data-action="ajouter-libre">Ajouter</button></div></div></div>' +
      "</fieldset>";
    return html;
  }

  function vueResultat(id) {
    const e = S.etat;
    const p = e.paris.find((x) => x.id === id);
    if (!p) { rendre('<div class="message message-erreur">Pari introuvable.</div>'); return; }
    if (!S.resolution[id]) {
      const r = p.resultat ? copie(p.resultat) : null;
      S.resolution[id] = r || { choix: { option: null }, oui_non: { oui: [] }, classement: { ordre: [] }, estimation: { valeur: "" }, scores: { valeurs: {} }, vote: { pourcentages: {} } }[p.type];
    }
    const r = S.resolution[id];
    let html = '<a class="retour" href="#/admin/paris">' + ICONES.retour + "Tous les paris</a><h1>Résultat : " + esc(p.titre) + "</h1>";
    if (p.etat !== "clos" && p.etat !== "resolu") html += '<div class="message message-erreur">Ce pari n’est pas encore clos. Le résultat pourra être saisi après le ' + heure(dms(p.cloture)) + ".</div>";
    html += '<p class="discret">' + pluriel(p.nbParieurs, "joueur a parié", "joueurs ont parié") + ". En enregistrant, les points de chacun sont calculés. Tu pourras corriger le résultat ensuite : tout sera recalculé.</p>";
    if (p.config && p.config.lien) html += '<div class="message message-info">Ce pari est relié au tableau des candidats : son résultat est calculé tout seul dès que tu coches l’étape correspondante dans le <a href="#/admin/candidats">tableau</a>. Un résultat saisi ici sera remplacé par celui du tableau.</div>';

    if (p.type === "choix") {
      html += '<div class="bulletins" role="radiogroup" aria-label="Bonne réponse">' + p.options.map((o) =>
        '<button type="button" class="bulletin" role="radio" aria-checked="' + (r.option === o.id) + '" data-action="res-choix" data-pari="' + esc(p.id) + '" data-option="' + esc(o.id) + '" data-cle="r-' + esc(o.id) + '"><span class="bulletin-nom">' + esc(o.label) + "</span></button>"
      ).join("") + "</div>";
    } else if (p.type === "oui_non") {
      html += '<p>Coche les noms pour lesquels la réponse est oui. Les autres comptent comme non.</p><div class="ligne" style="margin-bottom:.75rem">' +
        '<button type="button" class="bouton bouton-petit bouton-clair" data-action="res-tout" data-pari="' + esc(p.id) + '" data-val="1">Tout cocher</button>' +
        '<button type="button" class="bouton bouton-petit bouton-clair" data-action="res-tout" data-pari="' + esc(p.id) + '" data-val="0">Tout décocher</button></div>' +
        '<div class="bulletins">' + p.options.map((o) =>
          '<button type="button" class="bulletin" aria-pressed="' + ((r.oui || []).indexOf(o.id) >= 0) + '" data-action="res-oui" data-pari="' + esc(p.id) + '" data-option="' + esc(o.id) + '" data-cle="r-' + esc(o.id) + '"><span class="bulletin-nom">' + esc(o.label) + "</span></button>"
        ).join("") + "</div>";
    } else if (p.type === "classement") {
      const places = Number(p.config.places) || 3;
      for (let i = 0; i < places; i++) {
        html += '<label class="champ"><span>Place ' + (i + 1) + (p.config.sens === "bas" && i === 0 ? ", le tout dernier" : "") + '</span><select data-input="res-place" data-pari="' + esc(p.id) + '" data-i="' + i + '"><option value="">Choisir</option>' +
          p.options.map((o) => '<option value="' + esc(o.id) + '"' + ((r.ordre || [])[i] === o.id ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select></label>";
      }
    } else if (p.type === "estimation") {
      html += '<label class="champ" style="max-width:16rem"><span>Valeur officielle (' + esc(p.config.unite || "") + ')</span><input type="number" step="any" value="' + esc(r.valeur) + '" data-input="res-valeur" data-pari="' + esc(p.id) + '"></label>';
    } else if (p.type === "scores") {
      html += '<p>Le score officiel de chaque candidat, en % des suffrages exprimés.</p><div class="defile"><table class="admin-table"><tbody>' + p.options.map((o) =>
        "<tr><td>" + esc(o.label) + '</td><td class="pct"><input type="number" step="0.01" min="0" max="100" value="' + esc((r.valeurs || {})[o.id] !== undefined ? r.valeurs[o.id] : "") + '" data-input="res-score" data-pari="' + esc(p.id) + '" data-option="' + esc(o.id) + '" aria-label="Score de ' + esc(o.label) + '"></td></tr>'
      ).join("") + "</tbody></table></div>";
    } else if (p.type === "vote") {
      html += '<p>Facultatif : les pourcentages officiels de chaque candidat. Ils s’affichent aux joueurs et servent au trophée du Grand Déçu (pour le 1er tour). Laisse vide ce que tu ne connais pas.</p>' +
        '<div class="defile"><table class="admin-table"><tbody>' + p.options.map((o) =>
          "<tr><td>" + esc(o.label) + '</td><td class="pct"><input type="number" step="0.01" min="0" max="100" value="' + esc((r.pourcentages || {})[o.id] !== undefined ? r.pourcentages[o.id] : "") + '" data-input="res-pct" data-pari="' + esc(p.id) + '" data-option="' + esc(o.id) + '" aria-label="Pourcentage de ' + esc(o.label) + '"></td></tr>'
        ).join("") + "</tbody></table></div>";
    }
    html += '<div class="action-pari">' + (p.etat === "resolu" ? '<button type="button" class="bouton-lien" data-action="annuler-resultat" data-pari="' + esc(p.id) + '">Annuler le résultat</button>' : "<span></span>") +
      '<button type="button" class="bouton bouton-rouge" data-action="enregistrer-resultat" data-pari="' + esc(p.id) + '"' + (p.etat === "clos" || p.etat === "resolu" ? "" : " disabled") + ">Enregistrer le résultat et calculer les points</button></div>";
    rendre(html);
  }

  async function adminInvitations() {
    const res = await api("/api/jeu/admin/invitations");
    const lien = (code) => location.origin + location.pathname + "#/inscription/" + code;
    return '<form class="carte" data-form="invitation" novalidate style="margin-bottom:1.5rem"><h3 style="margin-top:0">Créer un code</h3>' +
      '<p class="discret petit">Un code à usage unique par personne, ou un code de groupe utilisable plusieurs fois : à toi de voir.</p><div class="grille-2">' +
      '<label class="champ"><span>Nombre d’utilisations</span><input type="number" name="utilisations_max" min="1" max="200" value="1"></label>' +
      '<label class="champ"><span>Note pour toi</span><input type="text" name="note" maxlength="200" placeholder="Pour qui ?"></label></div>' +
      '<button class="bouton" type="submit">Créer le code</button></form>' +
      (res.invitations.length
        ? '<div class="defile"><table class="admin-table"><thead><tr><th>Code</th><th>Utilisé</th><th>Note</th><th></th></tr></thead><tbody>' +
          res.invitations.map((i) =>
            '<tr><td><span class="code-invit">' + esc(i.code) + '</span></td><td class="chiffre">' + i.utilisations + " / " + i.utilisations_max + "</td><td>" + esc(i.note) + "</td>" +
            '<td class="actions"><button type="button" class="bouton bouton-petit bouton-clair" data-action="copier" data-texte="' + esc("Rejoins « " + JEU.nom + " », le jeu de pronostics sur la présidentielle 2027 : " + lien(i.code) + " (code : " + i.code + ")") + '">Copier l’invitation</button> ' +
            '<button type="button" class="bouton-lien" data-action="supprimer-invitation" data-id="' + esc(i.id) + '">Supprimer</button></td></tr>'
          ).join("") + "</tbody></table></div>"
        : '<div class="vide"><p>Aucun code pour l’instant.</p></div>');
  }

  async function adminJoueurs(e) {
    const res = await api("/api/jeu/admin/joueurs");
    return '<p class="discret">Changer la guilde d’un joueur déplace tous ses points vers sa nouvelle guilde. Pour réinitialiser un mot de passe ou supprimer un compte, passe par le tableau de bord PocketBase, collection users (voir le README du projet).</p>' +
      '<div class="defile"><table class="admin-table"><thead><tr><th>Joueur</th><th>Guilde</th><th>Email</th><th>Paris</th><th>Rôle</th></tr></thead><tbody>' +
      res.joueurs.map((j) =>
        "<tr><td><strong>" + esc(j.pseudo) + "</strong></td>" +
        '<td><select data-guilde-joueur="' + esc(j.id) + '" aria-label="Guilde de ' + esc(j.pseudo) + '">' + e.guildes.map((g) => '<option value="' + esc(g.id) + '"' + (g.id === j.guilde ? " selected" : "") + ">" + esc(g.nom) + "</option>").join("") + "</select></td>" +
        "<td>" + esc(j.email) + '</td><td class="chiffre">' + j.nbParis + "</td>" +
        "<td>" + (j.id === e.moi.id ? "Admin (toi)" :
          '<button type="button" class="bouton bouton-petit bouton-clair" data-action="role" data-id="' + esc(j.id) + '" data-role="' + (j.role === "admin" ? "joueur" : "admin") + '">' + (j.role === "admin" ? "Retirer l’admin" : "Rendre admin") + "</button>") + "</td></tr>"
      ).join("") + "</tbody></table></div>";
  }

  // ======================================================================
  // Actions (clics)
  // ======================================================================

  function pariCourant(el) {
    return S.etat.paris.find((p) => p.id === el.dataset.pari);
  }
  function rafraichirPari(p) { vuePari(p.id); }

  const ACTIONS = {
    badge: (el) => {
      if (el.dataset.ok === "true") Son.carillon();
      else Son.refus();
    },
    "choisir-guilde": (el) => {
      Son.pop();
      S.inscriptionGuilde = el.dataset.id;
      el.closest(".choix-guildes").querySelectorAll(".choix-guilde").forEach((b) => b.setAttribute("aria-checked", String(b === el)));
    },
    choisir: (el) => {
      const p = pariCourant(el);
      saisieDe(p).option = el.dataset.option;
      sonCandidat(el.dataset.option);
      rafraichirPari(p);
    },
    on: (el) => {
      const p = pariCourant(el);
      const s = saisieDe(p);
      s.reponses = s.reponses || {};
      if (s.reponses[el.dataset.option] === el.dataset.val) {
        delete s.reponses[el.dataset.option];
        Son.pop();
      } else {
        s.reponses[el.dataset.option] = el.dataset.val;
        sonCandidat(el.dataset.option);
      }
      rafraichirPari(p);
    },
    "on-effacer": (el) => {
      const p = pariCourant(el);
      saisieDe(p).reponses = {};
      rafraichirPari(p);
    },
    placer: (el) => {
      const p = pariCourant(el);
      const s = saisieDe(p);
      s.ordre = s.ordre || [];
      const i = s.ordre.indexOf(el.dataset.option);
      if (i >= 0) {
        s.ordre.splice(i, 1);
        Son.pop();
      } else if (s.ordre.length < (Number(p.config.places) || 3)) {
        s.ordre.push(el.dataset.option);
        sonCandidat(el.dataset.option);
      }
      rafraichirPari(p);
    },
    "vider-place": (el) => {
      const p = pariCourant(el);
      saisieDe(p).ordre.splice(Number(el.dataset.i), 1);
      rafraichirPari(p);
    },
    enregistrer: async (el) => {
      const p = pariCourant(el);
      el.disabled = true;
      const s = saisieDe(p);
      try {
        await api("/api/jeu/parier", { method: "POST", body: { pari: p.id, reponse: s } });
        coupDeTampon();
        sonValider();
        notifier(p.monProno ? "Modification enregistrée." : "Pari enregistré.");
        delete S.saisie[p.id];
        await chargerEtat(true);
        vuePari(p.id);
      } catch (err) {
        el.disabled = false;
        throw err;
      }
    },
    retirer: async (el) => {
      const p = pariCourant(el);
      if (!confirm("Retirer ton pari « " + p.titre + " » ?")) return;
      await api("/api/jeu/retirer", { method: "POST", body: { pari: p.id } });
      delete S.saisie[p.id];
      await chargerEtat(true);
      notifier("Pari retiré.");
      vuePari(p.id);
    },
    duel: async (el) => {
      const p = pariCourant(el);
      const sel = document.getElementById("duel-adversaire");
      await api("/api/jeu/duel", { method: "POST", body: { pari: p.id, adversaire: sel.value } });
      await chargerEtat(true);
      Son.carillon();
      notifier("Duel lancé contre " + sel.options[sel.selectedIndex].text + ".");
      vuePari(p.id);
    },
    deconnexion: () => {
      pb.authStore.clear();
      S.etat = null;
      S.classement = null;
      S.saisie = {};
      aller("#/connexion");
    },
    // --- Administration ---
    "ajouter-candidats": (el) => {
      const ed = S.edition;
      const deja = {};
      ed.options.forEach((o) => { deja[o.id] = true; });
      S.etat.candidats
        .filter((c) => el.dataset.filtre === "officiels" ? c.statut === "officiel" : c.statut === "declare" || c.statut === "officiel")
        .filter((c) => !deja[c.id])
        .forEach((c) => ed.options.push({ id: c.id, label: c.nom, pct: null }));
      vueEditionPari(ed.cle);
    },
    "ajouter-candidat": () => {
      const sel = document.getElementById("ajout-candidat");
      const c = S.etat.candidats.find((x) => x.id === sel.value);
      if (c) S.edition.options.push({ id: c.id, label: c.nom, pct: null });
      vueEditionPari(S.edition.cle);
    },
    "ajouter-libre": () => {
      const input = document.getElementById("ajout-libre");
      const label = input.value.trim();
      if (!label) return;
      S.edition.options.push({ id: "", label: label, pct: null });
      vueEditionPari(S.edition.cle);
    },
    "retirer-option": (el) => {
      S.edition.options.splice(Number(el.dataset.i), 1);
      vueEditionPari(S.edition.cle);
    },
    "vider-options": () => {
      if (!confirm("Retirer toutes les réponses possibles ?")) return;
      S.edition.options = [];
      vueEditionPari(S.edition.cle);
    },
    "enregistrer-pari": async (el) => {
      const invalide = ["ouverture", "cloture"].find((k) => S.edition && S.edition.datesInvalides && S.edition.datesInvalides[k]);
      if (invalide) throw new Error("La date " + (invalide === "ouverture" ? "d’ouverture" : "de clôture") + " n’est pas valide : jj/mm/aaaa et hh:mm, par exemple 18/04/2027 et 20:00.");
      el.disabled = true;
      try {
        const ed = S.edition;
        const res = await api("/api/jeu/admin/pari", { method: "POST", body: ed });
        notifier(ed.statut === "publie" ? "Pari enregistré et publié." : "Pari enregistré.");
        S.edition = null;
        await chargerEtat(true);
        location.hash = "#/admin/paris";
        if (!res.ok) throw new Error("Enregistrement impossible.");
      } catch (err) {
        el.disabled = false;
        throw err;
      }
    },
    "supprimer-pari": async () => {
      if (!confirm("Supprimer définitivement ce pari ?")) return;
      await api("/api/jeu/admin/supprimer-pari", { method: "POST", body: { pari: S.edition.id } });
      S.edition = null;
      await chargerEtat(true);
      notifier("Pari supprimé.");
      location.hash = "#/admin/paris";
    },
    "res-choix": (el) => {
      S.resolution[el.dataset.pari].option = el.dataset.option;
      vueResultat(el.dataset.pari);
    },
    "res-oui": (el) => {
      const r = S.resolution[el.dataset.pari];
      r.oui = r.oui || [];
      const i = r.oui.indexOf(el.dataset.option);
      if (i >= 0) r.oui.splice(i, 1);
      else r.oui.push(el.dataset.option);
      vueResultat(el.dataset.pari);
    },
    "res-tout": (el) => {
      const p = pariCourant(el);
      S.resolution[p.id].oui = el.dataset.val === "1" ? p.options.map((o) => o.id) : [];
      vueResultat(p.id);
    },
    "enregistrer-resultat": async (el) => {
      const id = el.dataset.pari;
      el.disabled = true;
      try {
        const res = await api("/api/jeu/admin/resoudre", { method: "POST", body: { pari: id, resultat: S.resolution[id] } });
        delete S.resolution[id];
        invalider();
        await chargerEtat(true);
        notifier("Résultat enregistré : " + pluriel(res.pronos, "pari recalculé", "paris recalculés") + ".");
        location.hash = "#/admin/paris";
      } catch (err) {
        el.disabled = false;
        throw err;
      }
    },
    "annuler-resultat": async (el) => {
      if (!confirm("Annuler le résultat ? Les points de ce pari repasseront à 0.")) return;
      await api("/api/jeu/admin/annuler-resultat", { method: "POST", body: { pari: el.dataset.pari } });
      delete S.resolution[el.dataset.pari];
      invalider();
      await chargerEtat(true);
      notifier("Résultat annulé.");
      vueResultat(el.dataset.pari);
    },
    "enregistrer-tableau": async (el) => {
      el.disabled = true;
      try {
        const res = await api("/api/jeu/admin/tableau", { method: "POST", body: lireTableau() });
        S.tableau = res;
        S.tableauFrais = true;
        invalider();
        await chargerEtat(true);
        notifier("Tableau enregistré. " + texteBilan(res.bilan));
        vueAdmin("candidats");
      } catch (err) {
        el.disabled = false;
        throw err;
      }
    },
    "ajouter-ligne": () => {
      const tbody = app.querySelector(".tableau-candidats tbody");
      if (!tbody) return;
      const tmp = document.createElement("tbody");
      tmp.innerHTML = ligneCandidat({ id: "", nom: "", parti: "", statut: "declare", bord: "" }, true);
      const tr = tmp.firstChild;
      tbody.insertBefore(tr, tbody.firstChild);
      tr.querySelector('[data-tab="nom"]').focus();
    },
    "supprimer-candidat": (el) => {
      const tr = el.closest("tr");
      if (!tr.dataset.ligneCand) { tr.remove(); majTotauxTableau(); return; }
      const oui = tr.classList.toggle("a-supprimer");
      el.textContent = oui ? "Annuler" : "Supprimer";
      if (oui) notifier("« " + tr.dataset.nomCand + " » sera supprimé à l’enregistrement du tableau.");
    },
    "importer-candidats": async (el) => {
      el.disabled = true;
      try {
        const res = await api("/api/jeu/admin/import-candidats", { method: "POST" });
        S.tableau = res;
        S.tableauFrais = true;
        S.rapportCandidats = res.rapportCandidats;
        invalider();
        await chargerEtat(true);
        notifier(pluriel(res.rapportCandidats.ajoutes.length, "candidat ajouté", "candidats ajoutés") + ". " + texteBilan(res.bilan));
        vueAdmin("candidats");
      } catch (err) {
        el.disabled = false;
        throw err;
      }
    },
    "cotes-parrainages": async (el) => {
      if (S.tableau && S.tableau.candidats.some((c) => (c.statut === "declare" || c.statut === "pressenti") && c.cote_parrainages !== null) &&
        !confirm("Remplacer les cotes des 500 signatures de tous les candidats déclarés et pressentis ? Tes ajustements seront écrasés.")) return;
      el.disabled = true;
      try {
        const res = await api("/api/jeu/admin/cotes-parrainages", { method: "POST" });
        S.tableau = res;
        S.tableauFrais = true;
        S.rapportCotes = res.rapportCotes;
        invalider();
        await chargerEtat(true);
        notifier(pluriel(res.rapportCotes.lignes.length, "cote calculée", "cotes calculées") + ". " + texteBilan(res.bilan));
        vueAdmin("candidats");
      } catch (err) {
        el.disabled = false;
        throw err;
      }
    },
    "importer-sondages": async (el) => {
      if (S.tableau && S.tableau.candidats.some((c) => c.intention_t1 !== null) &&
        !confirm("Remplacer les intentions de vote du 1er tour par la moyenne des derniers sondages ? Tes ajustements sur les candidats trouvés dans les sondages seront écrasés.")) return;
      el.disabled = true;
      try {
        const res = await api("/api/jeu/admin/import-sondages", { method: "POST" });
        S.tableau = res;
        S.tableauFrais = true;
        S.rapportImport = res.rapport;
        invalider();
        await chargerEtat(true);
        notifier(pluriel(res.rapport.trouves.length, "intention de vote importée", "intentions de vote importées") + ". " + texteBilan(res.bilan));
        vueAdmin("candidats");
      } catch (err) {
        el.disabled = false;
        throw err;
      }
    },
    "ouvrir-calendrier": (el) => {
      const champ = el.dataset.champ;
      if (S.calendrier && S.calendrier.champ === champ) { fermerCalendrier(); return; }
      const ms = dms(S.edition && S.edition[champ]) || maintenant();
      const d = new Date(ms);
      S.calendrier = { champ: champ, annee: d.getFullYear(), mois: d.getMonth() };
      dessinerCalendrier();
    },
    "cal-mois": (el) => {
      const c = S.calendrier;
      if (!c) return;
      const d = new Date(c.annee, c.mois + Number(el.dataset.delta), 1);
      c.annee = d.getFullYear();
      c.mois = d.getMonth();
      dessinerCalendrier();
    },
    "cal-jour": (el) => {
      const c = S.calendrier;
      if (!c) return;
      const conteneur = app.querySelector('[data-champ-date="' + c.champ + '"]');
      const champJour = conteneur.querySelector('[data-date="jour"]');
      champJour.value = el.dataset.jour;
      saisieDate(champJour, true);
      fermerCalendrier();
      const heure = conteneur.querySelector('[data-date="heure"]');
      if (heure) heure.focus();
    },
    copier: async (el) => {
      const texte = el.dataset.texte;
      try {
        await navigator.clipboard.writeText(texte);
        notifier("Invitation copiée : colle-la dans ta messagerie.");
      } catch (err) {
        window.prompt("Copie ce message :", texte);
      }
    },
    "supprimer-invitation": async (el) => {
      if (!confirm("Supprimer ce code ? Les comptes déjà créés avec ne sont pas touchés.")) return;
      await api("/api/jeu/admin/invitation-supprimer", { method: "POST", body: { id: el.dataset.id } });
      vueAdmin("invitations");
    },
    role: async (el) => {
      await api("/api/jeu/admin/role", { method: "POST", body: { id: el.dataset.id, role: el.dataset.role } });
      notifier(el.dataset.role === "admin" ? "Ce joueur est maintenant admin." : "Rôle d’admin retiré.");
      vueAdmin("joueurs");
    },
  };

  // ======================================================================
  // Saisies (champs modifiés sans tout redessiner)
  // ======================================================================

  const SAISIES = {
    filtre: (el) => filtrer(el),
    valeur: (el) => {
      const p = pariCourant(el);
      saisieDe(p).valeur = el.value;
      const curseur = app.querySelector('[data-input="valeur-curseur"]');
      if (curseur && el.value !== "") curseur.value = el.value;
      majBarreAction(p);
    },
    "valeur-curseur": (el) => {
      const p = pariCourant(el);
      saisieDe(p).valeur = el.value;
      const champ = app.querySelector('[data-input="valeur"]');
      if (champ) champ.value = el.value;
      majBarreAction(p);
    },
    vote: (el) => {
      const p = pariCourant(el);
      const s = saisieDe(p);
      // Le menu déclenche « input » puis « change » : un seul son.
      if (s[el.dataset.champ] !== el.value && el.value) sonCandidat(el.value);
      s[el.dataset.champ] = el.value;
      majBarreAction(p);
    },
    score: (el) => {
      const p = pariCourant(el);
      const s = saisieDe(p);
      s.valeurs = s.valeurs || {};
      if (el.value === "") delete s.valeurs[el.dataset.option];
      else s.valeurs[el.dataset.option] = el.value;
      const t = document.getElementById("total-scores");
      if (t) t.textContent = texteTotalScores(p, s);
      majBarreAction(p);
    },
    "calc-pct": (el) => {
      const v = Number(el.value);
      document.getElementById("calc-sortie").innerHTML = nb(pointsProba(v)) + "<small>points à " + pctTxt(v) + "</small>";
    },
    "calc-ecart": (el) => {
      const v = Number(el.value);
      document.getElementById("calc-ecart-sortie").innerHTML = nb(Math.max(0, Math.round(100 - 10 * v))) + "<small>points à " + String(v).replace(".", ",") + " point" + (v >= 2 ? "s" : "") + " d’écart</small>";
    },
    "res-place": (el) => {
      const r = S.resolution[el.dataset.pari];
      r.ordre = r.ordre || [];
      r.ordre[Number(el.dataset.i)] = el.value;
    },
    "res-valeur": (el) => { S.resolution[el.dataset.pari].valeur = el.value; },
    "tab-num": () => majTotauxTableau(),
    "res-score": (el) => {
      const r = S.resolution[el.dataset.pari];
      r.valeurs = r.valeurs || {};
      if (el.value === "") delete r.valeurs[el.dataset.option];
      else r.valeurs[el.dataset.option] = el.value;
    },
    "tab-filtre": (el) => {
      const q = norm(el.value.trim());
      S.filtreTableau = el.value;
      app.querySelectorAll("[data-ligne-cand]").forEach((tr) => tr.classList.toggle("cache", !!q && norm(tr.dataset.nomCand).indexOf(q) < 0));
    },
    "res-pct": (el) => {
      const r = S.resolution[el.dataset.pari];
      r.pourcentages = r.pourcentages || {};
      if (el.value === "") delete r.pourcentages[el.dataset.option];
      else r.pourcentages[el.dataset.option] = el.value;
    },
  };

  async function changerGuilde(el) {
    el.disabled = true;
    try {
      await api("/api/jeu/admin/guilde", { method: "POST", body: { id: el.dataset.guildeJoueur, guilde: el.value } });
      invalider();
      notifier("Guilde changée : " + el.options[el.selectedIndex].text + ".");
    } catch (err) {
      notifier(err.message, true);
    } finally {
      el.disabled = false;
    }
  }

  function majBarreAction(p) {
    const barre = app.querySelector(".action-pari");
    if (!barre) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = barreAction(p);
    barre.replaceWith(tmp.firstChild);
  }

  // Champs de l'éditeur de pari.
  function saisieEdition(el) {
    const ed = S.edition;
    if (!ed) return false;
    if (el.dataset.ed) {
      const k = el.dataset.ed;
      if (k === "lien") {
        ed.config = configParDefaut(el.value ? LIENS[el.value][1] : ed.type, el.value);
        if (el.value) ed.type = LIENS[el.value][1];
        ed.options = [];
        vueEditionPari(ed.cle);
        return true;
      }
      ed[k] = el.value;
      if (k === "type") {
        ed.config = configParDefaut(ed.type, "");
        vueEditionPari(ed.cle);
      }
      if (k === "coef") ed.options.forEach((o, i) => { const a = document.getElementById("apercu-" + i); if (a) a.textContent = apercuGain(ed, o.pct); });
      return true;
    }
    if (el.dataset.edcfg) {
      ed.config = ed.config || {};
      ed.config[el.dataset.edcfg] = el.value;
      return true;
    }
    if (el.dataset.edopt) {
      const i = Number(el.dataset.i);
      const o = ed.options[i];
      if (el.dataset.edopt === "pct") {
        o.pct = el.value === "" ? null : el.value;
        const a = document.getElementById("apercu-" + i);
        if (a) a.textContent = apercuGain(ed, o.pct);
      } else {
        o.label = el.value;
      }
      return true;
    }
    return false;
  }

  // ======================================================================
  // Formulaires
  // ======================================================================

  function erreurForm(form, message) {
    const z = form.querySelector(".erreur-form");
    if (z) z.innerHTML = message ? '<div class="message message-erreur">' + esc(message) + "</div>" : "";
  }

  const FORMULAIRES = {
    connexion: async (f) => {
      const email = f.email.value.trim();
      const mdp = f.mdp.value;
      if (!email || !mdp) return erreurForm(f, "Renseigne ton email et ton mot de passe.");
      try {
        await pb.collection("users").authWithPassword(email, mdp);
        invalider();
        aller("#/paris");
      } catch (err) {
        erreurForm(f, err.status === 429 ? "Trop de tentatives : patiente une minute." : "Email ou mot de passe incorrect.");
      }
    },
    inscription: async (f) => {
      const corps = {
        code: f.code ? f.code.value.trim() : "",
        pseudo: f.pseudo.value.trim(),
        email: f.email.value.trim(),
        motDePasse: f.mdp.value,
        guilde: S.inscriptionGuilde || "",
      };
      if (!corps.guilde) return erreurForm(f, "Choisis ta guilde.");
      try {
        await api("/api/jeu/inscription", { method: "POST", body: corps });
        await pb.collection("users").authWithPassword(corps.email, corps.motDePasse);
        S.inscriptionGuilde = "";
        notifier("Bienvenue dans le jeu !");
        aller("#/paris");
      } catch (err) {
        erreurForm(f, err.message);
      }
    },
    pseudo: async (f) => {
      const pseudo = f.pseudo.value.trim().replace(/\s+/g, " ");
      if (pseudo.length < 2 || pseudo.length > 30) return erreurForm(f, "Le pseudo doit faire entre 2 et 30 caractères.");
      try {
        const res = await api("/api/jeu/pseudo", { method: "POST", body: { pseudo: pseudo } });
        invalider();
        notifier(res.inchange ? "C’est déjà ton pseudo." : "Tu t’appelles désormais " + res.pseudo + ".");
        await vueProfil();
      } catch (err) {
        erreurForm(f, err.message);
      }
    },
    motdepasse: async (f) => {
      const ancien = f.ancien.value;
      const nouveau = f.nouveau.value;
      if (nouveau.length < 10) return erreurForm(f, "Le nouveau mot de passe doit faire au moins 10 caractères.");
      const moi = pb.authStore.record;
      try {
        await pb.collection("users").update(moi.id, { oldPassword: ancien, password: nouveau, passwordConfirm: nouveau });
        await pb.collection("users").authWithPassword(moi.email, nouveau);
        f.reset();
        erreurForm(f, "");
        notifier("Mot de passe changé.");
      } catch (err) {
        erreurForm(f, "Le mot de passe actuel est incorrect.");
      }
    },
    candidat: async (f) => {
      await api("/api/jeu/admin/candidat", { method: "POST", body: { nom: f.nom.value, parti: f.parti.value, statut: "declare" } });
      await chargerEtat(true);
      S.tableau = null;
      notifier("Candidat ajouté.");
      vueAdmin("candidats");
    },
    invitation: async (f) => {
      const res = await api("/api/jeu/admin/invitation", { method: "POST", body: { utilisations_max: f.utilisations_max.value, note: f.note.value } });
      notifier("Code créé : " + res.code);
      vueAdmin("invitations");
    },
  };

  // ======================================================================
  // Écouteurs
  // ======================================================================

  document.addEventListener("click", async (ev) => {
    const el = ev.target.closest("[data-action]");
    if (!el || !app.contains(el)) return;
    const action = ACTIONS[el.dataset.action];
    if (!action) return;
    ev.preventDefault();
    try {
      await action(el, ev);
    } catch (err) {
      notifier(err.message, true);
    }
  });

  // En phase de capture, avant les actions : un clic hors du champ de date ferme le calendrier.
  document.addEventListener("click", (ev) => {
    if (S.calendrier && !ev.target.closest(".champ-date")) fermerCalendrier();
  }, true);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && S.calendrier) {
      const bouton = app.querySelector('[data-champ-date="' + S.calendrier.champ + '"] .bouton-calendrier');
      fermerCalendrier();
      if (bouton) bouton.focus();
    }
  });

  document.addEventListener("input", (ev) => {
    const el = ev.target;
    if (el.dataset && el.dataset.input && SAISIES[el.dataset.input]) {
      try { SAISIES[el.dataset.input](el); } catch (err) { notifier(err.message, true); }
      return;
    }
    if (el.dataset && el.dataset.date) { saisieDate(el, false); return; }
    if (el.dataset && (el.dataset.ed || el.dataset.edcfg || el.dataset.edopt)) saisieEdition(el);
  });

  document.addEventListener("change", (ev) => {
    const el = ev.target;
    if (el.tagName === "SELECT" && el.dataset && el.dataset.input && SAISIES[el.dataset.input]) SAISIES[el.dataset.input](el);
    if (el.dataset && (el.dataset.ed === "type" || el.dataset.ed === "lien" || el.dataset.ed === "phase" || el.dataset.ed === "statut" || el.dataset.edcfg)) saisieEdition(el);
    if (el.dataset && el.dataset.date) saisieDate(el, true);
    if (el.dataset && el.dataset.guildeJoueur) changerGuilde(el);
  });

  document.addEventListener("submit", async (ev) => {
    const f = ev.target.closest("form[data-form]");
    if (!f) return;
    ev.preventDefault();
    const bouton = f.querySelector('button[type="submit"]');
    if (bouton) bouton.disabled = true;
    try {
      await FORMULAIRES[f.dataset.form](f);
    } catch (err) {
      erreurForm(f, err.message);
      notifier(err.message, true);
    } finally {
      if (bouton && document.body.contains(bouton)) bouton.disabled = false;
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !pb.authStore.isValid) return;
    if (Date.now() - S.etatLe > 60000 && /^#\/(paris|classement)?/.test(location.hash || "#/paris") && !S.edition) {
      invalider();
      router();
    }
  });

  window.addEventListener("hashchange", router);

  // Bouton de l'en-tête : ouvre le réglage des volumes.
  const boutonSon = document.getElementById("bouton-son");
  const panneauSon = document.getElementById("reglage-son");
  const curseurMusique = document.getElementById("volume-musique");
  const curseurBruitages = document.getElementById("volume-bruitages");
  function majBoutonSon() {
    const muet = !Volumes.musique && !Volumes.bruitages;
    boutonSon.classList.toggle("muet", muet);
    boutonSon.setAttribute("aria-expanded", String(!panneauSon.hidden));
    curseurMusique.value = Volumes.musique;
    curseurBruitages.value = Volumes.bruitages;
    document.getElementById("valeur-musique").textContent = Banque.musique ? (Volumes.musique ? Volumes.musique + " %" : "coupée") : "aucune";
    document.getElementById("valeur-bruitages").textContent = Volumes.bruitages ? Volumes.bruitages + " %" : "coupés";
    curseurMusique.disabled = !Banque.musique;
  }
  function fermerPanneauSon() {
    if (panneauSon.hidden) return;
    panneauSon.hidden = true;
    majBoutonSon();
  }
  boutonSon.addEventListener("click", () => {
    panneauSon.hidden = !panneauSon.hidden;
    majBoutonSon();
    if (!panneauSon.hidden) (Banque.musique ? curseurMusique : curseurBruitages).focus();
  });
  curseurMusique.addEventListener("input", () => {
    Volumes.regler("musique", curseurMusique.value);
    Musique.appliquer();
    majBoutonSon();
  });
  curseurBruitages.addEventListener("input", () => {
    Volumes.regler("bruitages", curseurBruitages.value);
    majBoutonSon();
  });
  // Un petit son à la fin du réglage, pour entendre le niveau choisi.
  curseurBruitages.addEventListener("change", () => Son.pop());
  document.addEventListener("click", (ev) => {
    if (!panneauSon.hidden && !ev.target.closest("#reglage-son") && !ev.target.closest("#bouton-son")) fermerPanneauSon();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !panneauSon.hidden) { fermerPanneauSon(); boutonSon.focus(); }
  });
  majBoutonSon();
  // Les navigateurs n'autorisent le son qu'après une première action : la musique démarre au premier clic.
  ["pointerdown", "keydown"].forEach((type) => document.addEventListener(type, () => Musique.appliquer(), { once: true }));
  chargerSons();

  document.getElementById("promo-ok").addEventListener("click", () => {
    Son.pop();
    document.getElementById("promo").classList.remove("visible");
  });
  document.getElementById("promo").addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") document.getElementById("promo").classList.remove("visible");
  });

  nav.addEventListener("click", (ev) => { if (ev.target.closest("a")) Son.clic(); });

  setInterval(() => {
    document.querySelectorAll(".decompte[data-cible]").forEach((d) => { d.innerHTML = texteDecompte(d.dataset.cible); });
  }, 30000);

  document.getElementById("nom-jeu").textContent = JEU.nom;
  document.title = JEU.nom;
  if (pb.authStore.isValid) {
    pb.collection("users").authRefresh().catch(() => { pb.authStore.clear(); router(); });
  }
  router();
})();
