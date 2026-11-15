import { z } from "zod";

/**
 * A logo da loja é guardada no próprio documento de configurações como data URL PNG.
 * O navegador redimensiona e converte para PNG antes de enviar, então o tamanho fica
 * pequeno; este limite só protege o documento do Firestore (máx. 1 MB) e as respostas
 * de GET /api/settings, que várias telas carregam.
 */
export const STORE_LOGO_MAX_LENGTH = 300_000;

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
// "iVBORw0KGgo" é a assinatura de arquivo PNG (\x89PNG\r\n\x1a\n) em base64.
const PNG_SIGNATURE_BASE64 = "iVBORw0KGgo";

export const storeLogoSchema = z.union([
  z.literal(""),
  z
    .string()
    .max(STORE_LOGO_MAX_LENGTH, "Logo muito grande. Use uma imagem menor.")
    .refine(
      (value) =>
        value.startsWith(PNG_DATA_URL_PREFIX + PNG_SIGNATURE_BASE64) &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(value.slice(PNG_DATA_URL_PREFIX.length)),
      "Logo inválida. Envie uma imagem PNG, JPG ou WebP."
    ),
]);

/** null é aceito como "remover logo" e normalizado para string vazia. */
export function parseStoreLogo(value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const result = storeLogoSchema.safeParse(value === null ? "" : value);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.issues[0]?.message || "Logo inválida" };
}
