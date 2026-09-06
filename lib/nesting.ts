// L'alinéa qui rend visible un niveau de hiérarchie quand un parent s'ouvre :
// une catégorie qui déplie ses séries, une série qui déplie ses tâches, une
// entreprise qui déplie son personnel. Sans lui, les enfants héritent au mieux
// d'un fond légèrement différent — rien qui dise « niveau inférieur ».
//
// Posé sur la LISTE, jamais sur les lignes : chaque ligne porte déjà son propre
// `px-4 sm:px-6`, et décaler ligne par ligne ferait dériver les deux paddings
// l'un de l'autre au premier changement.
//
// Écrit en toutes lettres, jamais construit par gabarit : le scanner statique
// de Tailwind lit le source et ne génère que les classes qu'il y voit
// littéralement — même raison que les classes de pastille de `lib/chartColors.ts`.
export const NESTED_LIST_INDENT =
  "ml-4 border-l-2 border-gray-300 dark:border-gray-700 sm:ml-6";
