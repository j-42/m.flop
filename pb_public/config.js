// Réglages du jeu modifiables sans toucher au reste du code.
// Les dates marquées « estimation: true » sont à corriger quand le décret de convocation sera publié.
// Format des dates : AAAA-MM-JJ, ou AAAA-MM-JJTHH:MM pour une heure précise (heure de Paris).

window.JEU = {
  nom: "Monsieur Flop",
  sousTitre: "Politiques et manigances",

  // Image affichée en haut de l’accueil : dépose ton image dans le dossier perso,
  // sous le nom affiche.jpg. Laisse "" pour ne pas afficher d’image.
  affiche: "perso/affiche.jpg",

  // Sons activés par défaut pour un nouveau joueur. Chacun peut les couper avec le bouton de l'en-tête.
  sonParDefaut: true,

  // Les grades de la carrière politique : nom, points nécessaires, icône.
  grades: [
    ["Militant de base", 0, "📣"],
    ["Colleur d’affiches", 50, "🪣"],
    ["Conseiller municipal", 100, "🪑"],
    ["Maire", 200, "🎗️"],
    ["Député", 350, "🏛️"],
    ["Ministre", 550, "💼"],
    ["Président", 800, "👑"],
  ],

  // Les grandes étapes du jeu, dans l'ordre.
  calendrier: [
    {
      phase: "campagne",
      nom: "Campagne",
      debut: "2026-11-01",
      fin: "2027-02-07",
      texte: "Les candidats se déclarent, se retirent, se rallient. Les premiers paris portent sur qui ira jusqu’au bout.",
    },
    {
      phase: "parrainages",
      nom: "Parrainages",
      debut: "2027-02-07",
      fin: "2027-03-12T18:00",
      estimation: true,
      texte: "Les élus envoient leurs parrainages au Conseil constitutionnel. Il en faut 500 pour être sur le bulletin.",
    },
    {
      phase: "premier_tour",
      nom: "Premier tour",
      debut: "2027-03-12T18:00",
      fin: "2027-04-18T20:00",
      texte: "La liste officielle est connue. On parie sur le podium, le flop, le boulet, les scores, l’abstention et le vote blanc.",
    },
    {
      phase: "second_tour",
      nom: "Second tour",
      debut: "2027-04-18T20:00",
      fin: "2027-05-02T20:00",
      texte: "Deux finalistes. On parie sur le vainqueur et sur son score.",
    },
  ],

  // Les dates clés affichées dans le calendrier.
  jalons: [
    { date: "2027-02-07", label: "Publication du décret de convocation, au plus tard", estimation: true },
    { date: "2027-03-12T18:00", label: "Fin de la collecte des parrainages", estimation: true },
    { date: "2027-04-18T20:00", label: "Premier tour : fermeture des bureaux de vote à 20h" },
    { date: "2027-05-02T20:00", label: "Second tour : fermeture des bureaux de vote à 20h" },
    { date: "2027-05-03", label: "Remise des trophées" },
  ],
};
