/// <reference path="../pb_data/types.d.ts" />

// Nouveau statut de candidat : « pressenti », pour une personnalité citée dans les sondages
// qui ne s'est pas déclarée. Un pressenti n'entre dans aucun pari tant qu'il n'est pas déclaré.

migrate((app) => {
  const candidats = app.findCollectionByNameOrId("candidats");
  const champ = candidats.fields.getByName("statut");
  if (champ.values.indexOf("pressenti") < 0) {
    champ.values = champ.values.concat(["pressenti"]);
    app.save(candidats);
  }
}, (app) => {
  const candidats = app.findCollectionByNameOrId("candidats");
  app.findRecordsByFilter("candidats", "statut = 'pressenti'", "", 0, 0).forEach((r) => {
    r.set("statut", "retire");
    app.save(r);
  });
  const champ = candidats.fields.getByName("statut");
  champ.values = champ.values.filter((v) => v !== "pressenti");
  app.save(candidats);
});
