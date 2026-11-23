/// <reference path="../pb_data/types.d.ts" />

// Tableau unique des candidats.
// - Chaque candidat reçoit ses données : cote des 500 signatures, intentions de vote et scores des deux tours.
// - Une collection « reglages » garde le vote blanc, l'abstention et l'avancement du scrutin.
// - Nouveau type de pari « scores » : les joueurs donnent le score de chaque candidat, en %.
// - Les paris de départ sont reliés au tableau ; les paris de scores, d'abstention et de vote blanc sont ajoutés.
// Ne touche ni aux paris qui ont déjà des pronos, ni à ceux que l'admin a renommés.

migrate((app) => {
  const candidats = app.findCollectionByNameOrId("candidats");
  if (!candidats.fields.getByName("donnees")) {
    candidats.fields.add(new JSONField({ name: "donnees", maxSize: 20000 }));
    app.save(candidats);
  }

  const paris = app.findCollectionByNameOrId("paris");
  const champType = paris.fields.getByName("type");
  if (champType.values.indexOf("scores") < 0) {
    champType.values = champType.values.concat(["scores"]);
    app.save(paris);
  }

  let reglages = null;
  try { reglages = app.findCollectionByNameOrId("reglages"); } catch (err) { reglages = null; }
  if (!reglages) {
    reglages = new Collection({
      type: "base",
      name: "reglages",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { type: "text", name: "cle", required: true, max: 40 },
        { type: "json", name: "valeur", maxSize: 200000 },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_reglages_cle ON reglages (cle)"],
    });
    app.save(reglages);
    const r = new Record(reglages);
    r.set("cle", "scrutin");
    r.set("valeur", {
      liste_officielle: false, resultats_t1: false, resultats_t2: false,
      t1: { abstention: null, blanc: null }, t2: { abstention: null, blanc: null },
      sondage: null,
    });
    app.save(r);
  }

  const lire = (rec, champ) => {
    try {
      const t = toString(rec.get(champ));
      return t && t !== "null" ? JSON.parse(t) : null;
    } catch (err) { return null; }
  };
  const nbPronos = (id) => app.countRecords("pronos", $dbx.exp("pari = {:p}", { p: id }));

  // ---------- Paris de départ reliés au tableau ----------
  const reliages = {
    "Qui aura ses 500 signatures ?": {
      lien: "parrainages",
      description: "Pour chaque candidat, réponds oui ou non : sera-t-il sur la liste officielle du Conseil constitutionnel ? Tu peux répondre pour autant de noms que tu veux.",
    },
    "Combien de candidats sur la liste officielle ?": { lien: "nb_officiels" },
    "Podium du 1er tour": { lien: "podium_t1" },
    "Flop 3 du 1er tour": { lien: "flop_t1" },
    "Le Boulet : qui fera le pire score ?": { lien: "boulet_t1" },
    "Taux de participation au 1er tour": {
      lien: "abstention_t1",
      titre: "Taux d'abstention au 1er tour",
      description: "Le taux d'abstention officiel en France entière, en pourcentage des inscrits.",
    },
    "Mon vote au 1er tour": { lien: "vote_t1" },
    "Mon vote au 2nd tour": {
      lien: "vote_t2",
      description: "Facultatif et sans points. Les deux finalistes sont ajoutés d'après les scores du 1er tour. Les réponses de tout le monde sont dévoilées une fois les résultats saisis.",
    },
    "Qui sera élu ?": {
      lien: "elu",
      description: "Les deux finalistes sont ajoutés d'après les scores du 1er tour. Leurs cotes viennent des intentions de vote au 2nd tour.",
    },
    "Score du vainqueur au 2nd tour": { lien: "score_vainqueur_t2" },
  };
  const liensPresents = {};
  app.findRecordsByFilter("paris", "id != ''", "", 0, 0).forEach((rec) => {
    const config = lire(rec, "config") || {};
    if (config.lien) { liensPresents[config.lien] = true; return; }
    const r = reliages[rec.getString("titre")];
    if (!r || liensPresents[r.lien] || nbPronos(rec.id) > 0) return;
    config.lien = r.lien;
    rec.set("config", config);
    if (r.titre) rec.set("titre", r.titre);
    if (r.description) rec.set("description", r.description);
    app.save(rec);
    liensPresents[r.lien] = true;
  });

  // ---------- Nouveaux paris, en brouillon ----------
  const T1 = "2027-04-18T18:00:00.000Z"; // 18 avril 2027, 20h heure de Paris
  const T2 = "2027-05-02T18:00:00.000Z"; // 2 mai 2027, 20h heure de Paris
  const LISTE_OFFICIELLE = "2027-03-16T08:00:00.000Z"; // estimation
  const LENDEMAIN_T1 = "2027-04-19T06:00:00.000Z";
  const nouveaux = [
    {
      titre: "Scores du 1er tour", type: "scores", phase: "premier_tour", ouverture: LISTE_OFFICIELLE, cloture: T1,
      description: "Le score de chaque candidat au 1er tour, en pourcentage des suffrages exprimés.",
      config: { lien: "scores_t1", unite: "%", pente: 10 },
    },
    {
      titre: "Vote blanc au 1er tour", type: "estimation", phase: "premier_tour", ouverture: LISTE_OFFICIELLE, cloture: T1,
      description: "La part des votes blancs au 1er tour, en pourcentage des votants.",
      config: { lien: "blanc_t1", unite: "%", pente: 20, decimales: 1, min: 0, max: 30 },
    },
    {
      titre: "Scores du 2nd tour", type: "scores", phase: "second_tour", ouverture: LENDEMAIN_T1, cloture: T2,
      description: "Le score de chacun des deux finalistes, en pourcentage des suffrages exprimés. Les finalistes sont ajoutés d'après les scores du 1er tour.",
      config: { lien: "scores_t2", unite: "%", pente: 10 },
    },
    {
      titre: "Taux d'abstention au 2nd tour", type: "estimation", phase: "second_tour", ouverture: LENDEMAIN_T1, cloture: T2,
      description: "Le taux d'abstention officiel en France entière, en pourcentage des inscrits.",
      config: { lien: "abstention_t2", unite: "%", pente: 10, decimales: 1, min: 0, max: 100 },
    },
    {
      titre: "Vote blanc au 2nd tour", type: "estimation", phase: "second_tour", ouverture: LENDEMAIN_T1, cloture: T2,
      description: "La part des votes blancs au 2nd tour, en pourcentage des votants.",
      config: { lien: "blanc_t2", unite: "%", pente: 20, decimales: 1, min: 0, max: 30 },
    },
  ];
  nouveaux.forEach((p) => {
    if (liensPresents[p.config.lien]) return;
    const r = new Record(paris);
    r.set("titre", p.titre);
    r.set("description", p.description);
    r.set("type", p.type);
    r.set("phase", p.phase);
    r.set("ouverture", p.ouverture);
    r.set("cloture", p.cloture);
    r.set("coef", 1);
    r.set("options", []);
    r.set("config", p.config);
    r.set("statut", "brouillon");
    app.save(r);
  });
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("reglages")); } catch (err) {}
  const candidats = app.findCollectionByNameOrId("candidats");
  candidats.fields.removeByName("donnees");
  app.save(candidats);
});
