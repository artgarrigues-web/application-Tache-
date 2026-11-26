/* Permet aux tests (lancés directement par Node) d'importer les fichiers de lib/ qui
   s'importent entre eux SANS extension (« ./fuseau »), comme le fait Next.js.
   Si Node ne trouve pas « ./fuseau », on réessaie avec « ./fuseau.ts ». */
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (erreur) {
    if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + ".ts", context);
    throw erreur;
  }
}`));
