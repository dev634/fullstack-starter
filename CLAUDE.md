# Règles du projet

Ces règles sont **impératives** et doivent être suivies à la lettre sur ce dépôt.

## Conventions de code

1. **UX mobile-first.** Toujours concevoir l'interface pour mobile d'abord :
   base en `flex-col` / pleine largeur, puis élargir avec les breakpoints
   (`sm:`, `md:`…). Ne jamais partir d'un layout desktop qu'on « répare »
   ensuite pour le mobile.
2. **DRY** (Don't Repeat Yourself). Factoriser toute logique ou tout markup
   dupliqué dans un helper / hook / composant partagé plutôt que de le
   copier-coller.
3. **SOLID.** Respecter les principes SOLID : responsabilité unique par
   module/fonction, code ouvert à l'extension mais fermé à la modification,
   dépendre d'abstractions plutôt que d'implémentations concrètes.

## Après CHAQUE nouvelle fonctionnalité

À exécuter dans cet ordre, systématiquement, une fois la feature implémentée :

4. **Code review.** Relire le diff de la feature (correction, lisibilité,
   respect des règles 1–3) avant de considérer la feature terminée.
5. **Refactorisation si besoin.** Si la code review révèle de la duplication,
   de la complexité inutile ou une violation de DRY/SOLID, refactoriser.
6. **Revue de cybersécurité.** Passer en revue les aspects sécurité de la
   feature : autorisation (rôle requis sur chaque mutation), validation des
   entrées, injection, gestion des secrets, exposition de données.
