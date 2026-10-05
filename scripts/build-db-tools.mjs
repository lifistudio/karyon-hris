import { build } from "esbuild";
for (const [entry, output] of [["scripts/setup-database.ts","db-setup"],["src/scripts/seed.ts","db-seed"]]) await build({entryPoints:[entry],outfile:`dist/${output}.cjs`,bundle:true,platform:"node",target:"node24",format:"cjs",tsconfig:"tsconfig.json",external:["pg-native","next/headers"],logLevel:"info"});

