import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // `type` et fonctions uniquement — pas d'`interface`, pas de `class`.
  // Mesuré avant d'outiller : 0 classe et 3 interfaces dans le dépôt, toutes
  // les trois de l'augmentation de module, où la fusion de déclarations
  // n'existe QUE pour `interface`. D'où l'exception ciblée sur les `.d.ts`
  // plutôt qu'une désactivation au cas par cas : vérifié en remplaçant l'une
  // d'elles par un `type`, la compilation casse ailleurs (le champ augmenté
  // retombe en `unknown` chez l'appelant), sans rien signaler sur place.
  // tests/ est exempte du bannissement de `class`, pas de la regle sur les
  // types : les 7 occurrences trouvees sont toutes des doublures de SDK
  // tiers fondes sur des classes (`new Anthropic()`, `new OpenAI()`), donc
  // la doublure doit elle-meme etre une classe sous peine de casser a
  // l instanciation. L exemption disparait le jour ou ces SDK cessent de
  // s instancier par `new`, ou si une classe apparait dans un test pour
  // une autre raison — auquel cas c est le test qu il faut revoir.
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["**/*.d.ts", "app/generated/**", "tests/**", "tests-integration/**"],
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ClassDeclaration",
          message: "Pas de class : le code metier vit dans des fonctions pures (voir ~/.claude/CLAUDE.md).",
        },
        {
          selector: "ClassExpression",
          message: "Pas de class : le code metier vit dans des fonctions pures (voir ~/.claude/CLAUDE.md).",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
