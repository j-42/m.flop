/// <reference path="../pb_data/types.d.ts" />

// Création de la base du jeu : guildes, candidats, paris, pronos, duels, invitations,
// réglages de sécurité et données de départ.
// Ce fichier est exécuté une seule fois, au premier démarrage de PocketBase.

migrate((app) => {
  // ---------- Guildes ----------
  const guildes = new Collection({
    type: "base",
    name: "guildes",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "text", name: "nom", required: true, max: 80 },
      { type: "text", name: "couleur", max: 20 },
      { type: "number", name: "ordre", onlyInt: true },
    ],
  });
  app.save(guildes);

  // ---------- Joueurs (collection users fournie par PocketBase) ----------
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new TextField({ name: "pseudo", required: true, min: 2, max: 30 }));
  users.fields.add(new RelationField({ name: "guilde", collectionId: guildes.id, maxSelect: 1, required: true }));
  users.fields.add(new SelectField({ name: "role", values: ["joueur", "admin"], maxSelect: 1 }));
  const champMdp = users.fields.getByName("password");
  if (champMdp) champMdp.min = 10;
  users.indexes.push("CREATE UNIQUE INDEX idx_users_pseudo ON users (pseudo COLLATE NOCASE)");
  // Personne ne crée de compte directement : l'inscription passe par /api/jeu/inscription.
  users.listRule = null;
  users.viewRule = "id = @request.auth.id";
  users.createRule = null;
  users.deleteRule = null;
  // Un joueur peut seulement changer son mot de passe : ni rôle, ni guilde, ni pseudo, ni email.
  users.updateRule = "id = @request.auth.id && @request.body.role:isset = false && @request.body.guilde:isset = false && @request.body.pseudo:isset = false && @request.body.email:isset = false && @request.body.verified:isset = false";
  users.oauth2.enabled = false;
  users.otp.enabled = false;
  users.passwordAuth.enabled = true;
  users.passwordAuth.identityFields = ["email"];
  app.save(users);

  // ---------- Candidats ----------
  const candidats = new Collection({
    type: "base",
    name: "candidats",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "text", name: "nom", required: true, max: 80 },
      { type: "text", name: "parti", max: 120 },
      { type: "select", name: "statut", values: ["declare", "officiel", "non_retenu", "retire"], maxSelect: 1, required: true },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
  });
  app.save(candidats);

  // ---------- Paris ----------
  const paris = new Collection({
    type: "base",
    name: "paris",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "text", name: "titre", required: true, max: 150 },
      { type: "text", name: "description", max: 2000 },
      { type: "select", name: "type", values: ["choix", "oui_non", "classement", "estimation", "vote"], maxSelect: 1, required: true },
      { type: "select", name: "phase", values: ["campagne", "parrainages", "premier_tour", "second_tour"], maxSelect: 1, required: true },
      { type: "date", name: "ouverture", required: true },
      { type: "date", name: "cloture", required: true },
      { type: "number", name: "coef" },
      { type: "json", name: "options", maxSize: 200000 },
      { type: "json", name: "config", maxSize: 20000 },
      { type: "select", name: "statut", values: ["brouillon", "publie", "resolu"], maxSelect: 1, required: true },
      { type: "json", name: "resultat", maxSize: 200000 },
      { type: "date", name: "resolu_le" },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
  });
  app.save(paris);

  // ---------- Pronos : un par joueur et par pari ----------
  const pronos = new Collection({
    type: "base",
    name: "pronos",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "joueur", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "relation", name: "pari", collectionId: paris.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "json", name: "reponse", maxSize: 50000 },
      { type: "number", name: "points" },
      { type: "number", name: "modifs", onlyInt: true },
      { type: "date", name: "parie_le" },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_pronos_joueur_pari ON pronos (joueur, pari)"],
  });
  app.save(pronos);

  // ---------- Duels ----------
  const duels = new Collection({
    type: "base",
    name: "duels",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "lanceur", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "relation", name: "adversaire", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "relation", name: "pari", collectionId: paris.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_duels_unique ON duels (lanceur, adversaire, pari)"],
  });
  app.save(duels);

  // ---------- Invitations ----------
  const invitations = new Collection({
    type: "base",
    name: "invitations",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "text", name: "code", required: true, max: 40 },
      { type: "number", name: "utilisations_max", onlyInt: true },
      { type: "number", name: "utilisations", onlyInt: true },
      { type: "text", name: "note", max: 200 },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_invitations_code ON invitations (code)"],
  });
  app.save(invitations);

  // ---------- Réglages : limitation des tentatives et sauvegardes automatiques ----------
  const settings = app.settings();
  settings.meta.appName = "Monsieur Flop";
  settings.rateLimits.enabled = true;
  settings.rateLimits.rules.push({ label: "/api/jeu/inscription", audience: "", duration: 60, maxRequests: 10 });
  settings.rateLimits.rules.push({ label: "users:auth", audience: "", duration: 60, maxRequests: 10 });
  settings.backups.cron = "0 4 * * *";
  settings.backups.cronMaxKeep = 14;
  app.save(settings);

  // ---------- Données de départ : guildes ----------
  const listeGuildes = [
    ["Gros poutous", "#D94F70"],
    ["Les islamo-gauchistes", "#B8432F"],
    ["L'important c'est de participer", "#E07B39"],
    ["La team En même temps", "#C9930F"],
    ["Scouts et Guides de France", "#5E8C3A"],
    ["Les Mocassins à glands", "#2E8B8B"],
    ["Jeanne, au secours !", "#3A6FB0"],
    ["La Guilde du guide cosmique", "#7A4FA3"],
    ["La politique de Mamba", "#5A6A85"],
  ];
  listeGuildes.forEach((g, i) => {
    const r = new Record(guildes);
    r.set("nom", g[0]);
    r.set("couleur", g[1]);
    r.set("ordre", i + 1);
    app.save(r);
  });

  // ---------- Données de départ : candidats déclarés, liste franceinfo au 18/11/2026 ----------
  const listeCandidats = [
    ["Nathalie Arthaud", "Lutte ouvrière"],
    ["François Asselineau", "Union populaire républicaine"],
    ["Gabriel Attal", "Renaissance"],
    ["Delphine Batho", "Génération écologie"],
    ["Olivier Becht", "Sans parti"],
    ["Augustin Billetdoux", "Sans parti"],
    ["Karim Bouamrane", "Parti socialiste"],
    ["Juan Branco", "Les Ruches"],
    ["Joël Chevé", "La France adulte"],
    ["Christian Collovati", "Sans parti"],
    ["Nicolas Dupont-Aignan", "Debout la France"],
    ["Sylvain Pierre Durif", "Sans parti"],
    ["Clara Egger", "Solution démocratique"],
    ["Raphaël Glucksmann", "Place publique"],
    ["Anasse Kazib", "Révolution permanente"],
    ["Selma Labib", "NPA-Révolutionnaires"],
    ["Francis Lalanne", "Sans parti"],
    ["Jean Lassalle", "Résistons"],
    ["Marine Le Pen", "Rassemblement national"],
    ["Jean-François Legendre", "A nous maintenant"],
    ["David Lisnard", "Nouvelle Energie"],
    ["Mira Markovic", "Parti animaliste"],
    ["Benoît Mathieu", "Sans parti"],
    ["Jean-Luc Mélenchon", "La France insoumise"],
    ["Antoine Mikolajczak", "Equinoxe"],
    ["Manolo Mlekuz", "Trajectoire"],
    ["Edouard Philippe", "Horizons"],
    ["Florian Philippot", "Les Patriotes"],
    ["Gilles Platret", "Sans parti"],
    ["Natacha Polony", "Sans parti"],
    ["Bruno Retailleau", "Les Républicains"],
    ["Teddy Riner", "Sans parti"],
    ["Erwan Rohou", "Mouvement écologiste indépendant"],
    ["Fabien Roussel", "Parti communiste français"],
    ["François Ruffin", "Debout !"],
    ["Serge Tinland", "Sans parti"],
    ["Marine Tondelier", "Les Ecologistes"],
    ["Eric Zemmour", "Reconquête"],
  ];
  const optionsCandidats = [];
  listeCandidats.forEach((c) => {
    const r = new Record(candidats);
    r.set("nom", c[0]);
    r.set("parti", c[1]);
    r.set("statut", "declare");
    app.save(r);
    optionsCandidats.push({ id: r.id, label: c[0], pct: null });
  });

  // ---------- Données de départ : catalogue de paris en brouillon ----------
  // Les dates marquées « estimation » sont à ajuster quand le décret de convocation sera publié.
  // Les probabilités sont à remplir par l'admin avant publication.
  const maintenant = new Date().toISOString();
  const T1 = "2027-04-18T18:00:00.000Z"; // 18 avril 2027, 20h heure de Paris
  const T2 = "2027-05-02T18:00:00.000Z"; // 2 mai 2027, 20h heure de Paris
  const FIN_PARRAINAGES = "2027-03-12T17:00:00.000Z"; // estimation : 12 mars 2027, 18h heure de Paris
  const LISTE_OFFICIELLE = "2027-03-16T08:00:00.000Z"; // estimation
  const LENDEMAIN_T1 = "2027-04-19T06:00:00.000Z";
  const blanc = { id: "x_blanc", label: "Vote blanc", pct: null };
  const abst = { id: "x_abstention", label: "Abstention", pct: null };

  const catalogue = [
    {
      titre: "Mon vote au 1er tour", type: "vote", phase: "premier_tour",
      description: "Facultatif et sans points. Pour qui tu vas voter, et pour qui tu aimerais voter. Les réponses de tout le monde sont dévoilées une fois les résultats saisis.",
      ouverture: maintenant, cloture: T1, coef: 1, options: optionsCandidats.concat([blanc, abst]), config: {},
    },
    {
      titre: "Qui aura ses 500 signatures ?", type: "oui_non", phase: "parrainages",
      description: "Pour chaque candidat, réponds oui ou non : sera-t-il sur la liste officielle du Conseil constitutionnel ? Tu réponds pour 10 noms au plus : garde ceux dont tu es le plus sûr.",
      ouverture: maintenant, cloture: FIN_PARRAINAGES, coef: 0.2, options: optionsCandidats, config: {},
    },
    {
      titre: "Combien de candidats sur la liste officielle ?", type: "estimation", phase: "parrainages",
      description: "Le nombre de candidats retenus par le Conseil constitutionnel.",
      ouverture: maintenant, cloture: FIN_PARRAINAGES, coef: 1, options: [],
      config: { unite: "candidats", pente: 20, decimales: 0, min: 0, max: 60 },
    },
    {
      titre: "Podium du 1er tour", type: "classement", phase: "premier_tour",
      description: "Les trois premiers du 1er tour, dans l'ordre.",
      ouverture: LISTE_OFFICIELLE, cloture: T1, coef: 1, options: [], config: { places: 3, sens: "haut" },
    },
    {
      titre: "Flop 3 du 1er tour", type: "classement", phase: "premier_tour",
      description: "Les trois derniers du 1er tour. La place 1 est le tout dernier, la place 2 l'avant-dernier, la place 3 celui juste avant.",
      ouverture: LISTE_OFFICIELLE, cloture: T1, coef: 1, options: [], config: { places: 3, sens: "bas" },
    },
    {
      titre: "Le Boulet : qui fera le pire score ?", type: "choix", phase: "premier_tour",
      description: "Le candidat qui obtiendra le plus petit score au 1er tour.",
      ouverture: LISTE_OFFICIELLE, cloture: T1, coef: 1, options: [], config: {},
    },
    {
      titre: "Taux de participation au 1er tour", type: "estimation", phase: "premier_tour",
      description: "Le taux de participation officiel en France entière, en pourcentage des inscrits.",
      ouverture: LISTE_OFFICIELLE, cloture: T1, coef: 1, options: [],
      config: { unite: "%", pente: 10, decimales: 1, min: 0, max: 100 },
    },
    {
      titre: "Mon vote au 2nd tour", type: "vote", phase: "second_tour",
      description: "Facultatif et sans points. Ajouter les deux finalistes après le 1er tour.",
      ouverture: LENDEMAIN_T1, cloture: T2, coef: 1, options: [blanc, abst], config: {},
    },
    {
      titre: "Qui sera élu ?", type: "choix", phase: "second_tour",
      description: "Ajouter les deux finalistes après le 1er tour.",
      ouverture: LENDEMAIN_T1, cloture: T2, coef: 1, options: [], config: {},
    },
    {
      titre: "Score du vainqueur au 2nd tour", type: "estimation", phase: "second_tour",
      description: "Le score du candidat élu, en pourcentage des suffrages exprimés.",
      ouverture: LENDEMAIN_T1, cloture: T2, coef: 1, options: [],
      config: { unite: "%", pente: 10, decimales: 1, min: 50, max: 100 },
    },
  ];
  catalogue.forEach((p) => {
    const r = new Record(paris);
    r.set("titre", p.titre);
    r.set("description", p.description);
    r.set("type", p.type);
    r.set("phase", p.phase);
    r.set("ouverture", p.ouverture);
    r.set("cloture", p.cloture);
    r.set("coef", p.coef);
    r.set("options", p.options);
    r.set("config", p.config);
    r.set("statut", "brouillon");
    app.save(r);
  });
}, (app) => {
  ["invitations", "duels", "pronos", "paris", "candidats"].forEach((nom) => {
    try { app.delete(app.findCollectionByNameOrId(nom)); } catch (err) {}
  });
  const users = app.findCollectionByNameOrId("users");
  ["pseudo", "guilde", "role"].forEach((f) => users.fields.removeByName(f));
  users.indexes = users.indexes.filter((i) => i.indexOf("idx_users_pseudo") < 0);
  app.save(users);
  try { app.delete(app.findCollectionByNameOrId("guildes")); } catch (err) {}
});
