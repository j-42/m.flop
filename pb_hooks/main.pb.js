/// <reference path="../pb_data/types.d.ts" />

// Routes du jeu. Toute la logique de calcul est dans jeu_lib.js.
// Les collections ne sont pas accessibles directement depuis l'extérieur :
// tout passe par ces routes, qui vérifient qui demande quoi et à quel moment.

// ---------- En-têtes de sécurité pour les pages du site ----------
routerUse((e) => {
  const chemin = e.request.url.path;
  if (chemin.indexOf("/api/") !== 0 && chemin.indexOf("/_/") !== 0) {
    const h = e.response.header();
    h.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    h.set("Referrer-Policy", "same-origin");
    h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  }
  return e.next();
});

// ---------- Public : guildes et premier compte ----------
routerAdd("GET", "/api/jeu/accueil", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  const guildes = lib.tous("guildes", "", "ordre").map(lib.guildeDepuisRecord);
  return e.json(200, { guildes: guildes, premierCompte: $app.countRecords("users") === 0 });
});

// ---------- Public : inscription avec un code d'invitation ----------
routerAdd("POST", "/api/jeu/inscription", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  const b = e.requestInfo().body || {};
  const email = String(b.email || "").trim().toLowerCase();
  const pseudo = String(b.pseudo || "").trim().replace(/\s+/g, " ");
  const mdp = String(b.motDePasse || "");
  const code = String(b.code || "").trim().toUpperCase();
  const guildeId = String(b.guilde || "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestError("L’adresse email n’est pas valide.");
  if (pseudo.length < 2 || pseudo.length > 30) throw new BadRequestError("Le pseudo doit faire entre 2 et 30 caractères.");
  if (mdp.length < 10) throw new BadRequestError("Le mot de passe doit faire au moins 10 caractères.");
  if (!lib.trouver("guildes", "id = {:g}", { g: guildeId })) throw new BadRequestError("Choisis ta guilde.");

  const MSG_CODE_INCONNU = "Ce code d’invitation est inconnu.";
  const MSG_CODE_EPUISE = "Ce code d’invitation a déjà servi le nombre de fois prévu.";
  // Contrôles rapides, pour des messages d'erreur précis. Ils sont refaits dans la transaction plus bas.
  if ($app.countRecords("users") > 0) {
    const invitation = lib.trouver("invitations", "code = {:c}", { c: code });
    if (!invitation) throw new BadRequestError(MSG_CODE_INCONNU);
    if (invitation.getInt("utilisations") >= invitation.getInt("utilisations_max")) throw new BadRequestError(MSG_CODE_EPUISE);
  }
  if (lib.trouver("users", "email = {:e}", { e: email })) throw new BadRequestError("Un compte existe déjà avec cet email.");
  if (lib.trouver("users", "pseudo = {:p}", { p: pseudo })) throw new BadRequestError("Ce pseudo est déjà pris.");

  const u = new Record($app.findCollectionByNameOrId("users"));
  u.set("email", email);
  u.setPassword(mdp);
  u.set("pseudo", pseudo);
  u.set("guilde", guildeId);
  u.set("verified", true);

  // Les écritures de PocketBase passent une par une : refaire ici les vérifications empêche deux inscriptions
  // simultanées de créer deux admins, ou de dépasser le nombre d'utilisations d'un code.
  let premier = false;
  let refus = "";
  try {
    $app.runInTransaction((tx) => {
      premier = tx.countRecords("users") === 0;
      if (!premier) {
        let inv = null;
        try {
          inv = tx.findFirstRecordByFilter("invitations", "code = {:c}", { c: code });
        } catch (err) {
          refus = MSG_CODE_INCONNU;
          throw err;
        }
        if (inv.getInt("utilisations") >= inv.getInt("utilisations_max")) {
          refus = MSG_CODE_EPUISE;
          throw new Error(refus);
        }
        inv.set("utilisations", inv.getInt("utilisations") + 1);
        tx.save(inv);
      }
      u.set("role", premier ? "admin" : "joueur");
      tx.save(u);
    });
  } catch (err) {
    throw new BadRequestError(refus || "Inscription impossible : ce pseudo ou cet email est peut-être déjà utilisé.");
  }
  return e.json(200, { ok: true, admin: premier });
});

// ---------- Joueur connecté : tout l'état du jeu en une fois ----------
routerAdd("GET", "/api/jeu/etat", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  const moi = lib.joueurDepuisRecord(e.auth);
  const estAdmin = moi.role === "admin";
  const maintenant = Date.now();

  const guildes = lib.tous("guildes", "", "ordre").map(lib.guildeDepuisRecord);
  const joueurs = lib.tous("users", "", "pseudo").map(lib.joueurDepuisRecord);
  const candidats = lib.tous("candidats", "", "nom").map(lib.candidatDepuisRecord);
  const pronos = lib.tous("pronos").map(lib.pronoDepuisRecord);
  const duels = lib.tous("duels", "", "created").map(lib.duelDepuisRecord);
  const parisRecs = lib.tous("paris", estAdmin ? "" : "statut != 'brouillon'", "cloture");

  const paris = parisRecs.map((rec) => {
    const p = lib.pariDepuisRecord(rec);
    const etat = lib.etatPari(p, maintenant);
    const pronosPari = pronos.filter((pr) => pr.pari === p.id);
    const mien = pronosPari.filter((pr) => pr.joueur === moi.id)[0];
    const devoile = lib.estDevoile(p, etat);
    const pointsDe = (id) => {
      const pr = pronosPari.filter((x) => x.joueur === id)[0];
      return pr ? pr.points : 0;
    };
    const sortie = Object.assign({}, p, {
      etat: etat,
      devoile: devoile,
      nbParieurs: pronosPari.length,
      monProno: mien ? { reponse: mien.reponse, points: mien.points, modifs: mien.modifs, maj: mien.maj } : null,
      duels: duels
        .filter((d) => d.pari === p.id && (d.lanceur === moi.id || d.adversaire === moi.id))
        .map((d) => Object.assign({}, d, lib.issueDuel(d, etat, pointsDe))),
    });
    if (p.statut !== "resolu") sortie.resultat = null;
    if (devoile) {
      sortie.stats = lib.statistiques(p, pronosPari);
      sortie.pronos = pronosPari.map((pr) => ({ joueur: pr.joueur, reponse: pr.reponse, points: pr.points }));
    }
    return sortie;
  });

  const monEmail = e.auth.getString("email");
  return e.json(200, {
    moi: Object.assign({}, moi, { email: monEmail }),
    guildes: guildes,
    joueurs: joueurs.map((j) => ({ id: j.id, pseudo: j.pseudo, guilde: j.guilde })),
    candidats: candidats,
    paris: paris,
    serveur: new Date().toISOString(),
  });
}, $apis.requireAuth("users"));

// ---------- Joueur connecté : poser ou modifier un pari ----------
routerAdd("POST", "/api/jeu/parier", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  const b = e.requestInfo().body || {};
  const rec = lib.trouver("paris", "id = {:id}", { id: String(b.pari || "") });
  if (!rec) throw new NotFoundError("Ce pari n’existe pas.");
  const p = lib.pariDepuisRecord(rec);
  const etat = lib.etatPari(p, Date.now());
  if (etat === "a_venir") throw new BadRequestError("Ce pari n’est pas encore ouvert.");
  if (etat !== "ouvert") throw new BadRequestError("Ce pari est clos : il n’est plus possible de parier.");
  const reponse = lib.normaliserReponse(p, b.reponse);

  let prono = lib.trouver("pronos", "joueur = {:j} && pari = {:p}", { j: e.auth.id, p: p.id });
  if (prono) {
    if (lib.stable(lib.lireJSON(prono, "reponse", null)) === lib.stable(reponse)) {
      return e.json(200, { ok: true, inchange: true });
    }
    prono.set("modifs", prono.getInt("modifs") + 1);
  } else {
    prono = new Record($app.findCollectionByNameOrId("pronos"));
    prono.set("joueur", e.auth.id);
    prono.set("pari", p.id);
    prono.set("points", 0);
    prono.set("modifs", 0);
  }
  prono.set("reponse", reponse);
  prono.set("parie_le", new Date().toISOString());
  $app.save(prono);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- Joueur connecté : retirer son pari tant que c'est ouvert ----------
routerAdd("POST", "/api/jeu/retirer", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  const b = e.requestInfo().body || {};
  const rec = lib.trouver("paris", "id = {:id}", { id: String(b.pari || "") });
  if (!rec) throw new NotFoundError("Ce pari n’existe pas.");
  if (lib.etatPari(lib.pariDepuisRecord(rec), Date.now()) !== "ouvert") throw new BadRequestError("Ce pari est clos.");
  const prono = lib.trouver("pronos", "joueur = {:j} && pari = {:p}", { j: e.auth.id, p: rec.id });
  if (prono) $app.delete(prono);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- Joueur connecté : lancer un duel ----------
routerAdd("POST", "/api/jeu/duel", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  const b = e.requestInfo().body || {};
  const rec = lib.trouver("paris", "id = {:id}", { id: String(b.pari || "") });
  if (!rec) throw new NotFoundError("Ce pari n’existe pas.");
  const p = lib.pariDepuisRecord(rec);
  if (p.type === "vote") throw new BadRequestError("Pas de duel sur « Mon vote » : ce pari ne rapporte pas de points.");
  if (lib.etatPari(p, Date.now()) !== "ouvert") throw new BadRequestError("Les duels se lancent tant que le pari est ouvert.");
  const adversaire = String(b.adversaire || "");
  if (adversaire === e.auth.id) throw new BadRequestError("Tu ne peux pas te défier toi-même.");
  if (!lib.trouver("users", "id = {:id}", { id: adversaire })) throw new BadRequestError("Ce joueur n’existe pas.");
  const existe = lib.trouver("duels", "pari = {:p} && ((lanceur = {:a} && adversaire = {:b}) || (lanceur = {:b} && adversaire = {:a}))",
    { p: p.id, a: e.auth.id, b: adversaire });
  if (existe) throw new BadRequestError("Un duel existe déjà entre vous deux sur ce pari.");
  const d = new Record($app.findCollectionByNameOrId("duels"));
  d.set("lanceur", e.auth.id);
  d.set("adversaire", adversaire);
  d.set("pari", p.id);
  $app.save(d);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- Joueur connecté : classements, évolution et trophées ----------
routerAdd("GET", "/api/jeu/classement", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  const guildes = lib.tous("guildes", "", "ordre").map(lib.guildeDepuisRecord);
  const joueurs = lib.tous("users", "", "pseudo").map(lib.joueurDepuisRecord);
  const paris = lib.tous("paris", "statut != 'brouillon'", "cloture").map(lib.pariDepuisRecord);
  const pronos = lib.tous("pronos").map(lib.pronoDepuisRecord);
  const duels = lib.tous("duels").map(lib.duelDepuisRecord);
  return e.json(200, lib.classementComplet(joueurs, guildes, paris, pronos, duels));
}, $apis.requireAuth("users"));

// =====================================================================
// Administration du jeu (joueurs avec le rôle « admin »)
// =====================================================================

routerAdd("POST", "/api/jeu/admin/pari", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  lib.exigerAdmin(e);
  const b = e.requestInfo().body || {};
  const d = lib.normaliserPari(b);
  let rec;
  if (b.id) {
    rec = lib.trouver("paris", "id = {:id}", { id: String(b.id) });
    if (!rec) throw new NotFoundError("Ce pari n’existe pas.");
    const actuel = lib.pariDepuisRecord(rec);
    const pronosPari = lib.tous("pronos", "pari = {:p}", "", { p: rec.id }).map(lib.pronoDepuisRecord);
    if (pronosPari.length > 0 && actuel.type !== d.type) throw new BadRequestError("Impossible de changer le type : des joueurs ont déjà parié.");
    lib.verifierModifPari(actuel, d, pronosPari, Date.now());
    if (actuel.statut === "resolu") d.statut = "resolu";
  } else {
    rec = new Record($app.findCollectionByNameOrId("paris"));
  }
  ["titre", "description", "type", "phase", "ouverture", "cloture", "coef", "options", "config", "statut"].forEach((k) => rec.set(k, d[k]));
  $app.runInTransaction((tx) => {
    tx.save(rec);
    if (d.statut === "resolu") lib.recalculerPoints(tx, rec);
  });
  return e.json(200, { ok: true, id: rec.id });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/jeu/admin/resoudre", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  lib.exigerAdmin(e);
  const b = e.requestInfo().body || {};
  const rec = lib.trouver("paris", "id = {:id}", { id: String(b.pari || "") });
  if (!rec) throw new NotFoundError("Ce pari n’existe pas.");
  const p = lib.pariDepuisRecord(rec);
  if (p.statut === "brouillon") throw new BadRequestError("Ce pari est encore en brouillon.");
  if (Date.now() < lib.dateMs(p.cloture)) throw new BadRequestError("Ce pari n’est pas encore clos : attends la clôture pour saisir le résultat.");
  const resultat = lib.normaliserResultat(p, b.resultat);
  rec.set("resultat", resultat);
  rec.set("statut", "resolu");
  if (!rec.getString("resolu_le")) rec.set("resolu_le", new Date().toISOString());
  let n = 0;
  $app.runInTransaction((tx) => {
    tx.save(rec);
    n = lib.recalculerPoints(tx, rec);
  });
  return e.json(200, { ok: true, pronos: n });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/jeu/admin/annuler-resultat", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  lib.exigerAdmin(e);
  const b = e.requestInfo().body || {};
  const rec = lib.trouver("paris", "id = {:id}", { id: String(b.pari || "") });
  if (!rec) throw new NotFoundError("Ce pari n’existe pas.");
  // Sinon un brouillon passerait en « publié » sans le contrôle des probabilités fait à la publication.
  if (rec.getString("statut") !== "resolu") throw new BadRequestError("Ce pari n’a pas de résultat à annuler.");
  rec.set("resultat", null);
  rec.set("statut", "publie");
  rec.set("resolu_le", "");
  $app.runInTransaction((tx) => {
    tx.save(rec);
    lib.recalculerPoints(tx, rec);
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/jeu/admin/supprimer-pari", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  lib.exigerAdmin(e);
  const b = e.requestInfo().body || {};
  const rec = lib.trouver("paris", "id = {:id}", { id: String(b.pari || "") });
  if (!rec) throw new NotFoundError("Ce pari n’existe pas.");
  if (lib.tous("pronos", "pari = {:p}", "", { p: rec.id }).length > 0) {
    throw new BadRequestError("Des joueurs ont déjà parié : ce pari ne peut plus être supprimé.");
  }
  $app.delete(rec);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/jeu/admin/candidat", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  lib.exigerAdmin(e);
  const b = e.requestInfo().body || {};
  const nom = String(b.nom || "").trim();
  if (!nom) throw new BadRequestError("Le nom est obligatoire.");
  const statut = lib.STATUTS_CANDIDAT.indexOf(b.statut) >= 0 ? b.statut : "declare";
  let rec;
  if (b.id) {
    rec = lib.trouver("candidats", "id = {:id}", { id: String(b.id) });
    if (!rec) throw new NotFoundError("Ce candidat n’existe pas.");
  } else {
    rec = new Record($app.findCollectionByNameOrId("candidats"));
  }
  rec.set("nom", nom.slice(0, 80));
  rec.set("parti", String(b.parti || "").trim().slice(0, 120));
  rec.set("statut", statut);
  $app.runInTransaction((tx) => {
    tx.save(rec);
    // Le nouveau nom est reporté dans les paris où ce candidat figure.
    tx.findRecordsByFilter("paris", "id != ''", "", 0, 0).forEach((pr) => {
      const options = lib.lireJSON(pr, "options", []) || [];
      let change = false;
      options.forEach((o) => {
        if (o.id === rec.id && o.label !== rec.getString("nom")) {
          o.label = rec.getString("nom");
          change = true;
        }
      });
      if (change) {
        pr.set("options", options);
        tx.save(pr);
      }
    });
  });
  return e.json(200, { ok: true, id: rec.id });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/jeu/admin/invitations", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  lib.exigerAdmin(e);
  const liste = lib.tous("invitations", "", "-created").map((r) => ({
    id: r.id,
    code: r.getString("code"),
    utilisations: r.getInt("utilisations"),
    utilisations_max: r.getInt("utilisations_max"),
    note: r.getString("note"),
    cree: lib.versISO(r.getString("created")),
  }));
  return e.json(200, { invitations: liste });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/jeu/admin/invitation", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  lib.exigerAdmin(e);
  const b = e.requestInfo().body || {};
  const max = Math.max(1, Math.min(200, parseInt(b.utilisations_max || 1, 10) || 1));
  const r = new Record($app.findCollectionByNameOrId("invitations"));
  r.set("code", $security.randomStringWithAlphabet(8, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"));
  r.set("utilisations_max", max);
  r.set("utilisations", 0);
  r.set("note", String(b.note || "").trim().slice(0, 200));
  $app.save(r);
  return e.json(200, { ok: true, code: r.getString("code") });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/jeu/admin/invitation-supprimer", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  lib.exigerAdmin(e);
  const b = e.requestInfo().body || {};
  const r = lib.trouver("invitations", "id = {:id}", { id: String(b.id || "") });
  if (r) $app.delete(r);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/jeu/admin/joueurs", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  lib.exigerAdmin(e);
  const pronos = lib.tous("pronos").map(lib.pronoDepuisRecord);
  const liste = lib.tous("users", "", "pseudo").map((u) => ({
    id: u.id,
    pseudo: u.getString("pseudo"),
    email: u.getString("email"),
    guilde: u.getString("guilde"),
    role: u.getString("role") || "joueur",
    inscrit: lib.versISO(u.getString("created")),
    nbParis: pronos.filter((p) => p.joueur === u.id).length,
  }));
  return e.json(200, { joueurs: liste });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/jeu/admin/role", (e) => {
  const lib = require(`${__hooks}/jeu_lib.js`);
  lib.exigerAdmin(e);
  const b = e.requestInfo().body || {};
  const u = lib.trouver("users", "id = {:id}", { id: String(b.id || "") });
  if (!u) throw new NotFoundError("Ce joueur n’existe pas.");
  const role = b.role === "admin" ? "admin" : "joueur";
  if (role === "joueur" && u.id === e.auth.id) throw new BadRequestError("Tu ne peux pas retirer ton propre rôle d’admin.");
  u.set("role", role);
  $app.save(u);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
