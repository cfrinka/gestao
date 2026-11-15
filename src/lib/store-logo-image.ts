import { STORE_LOGO_MAX_LENGTH } from "@/domains/settings/store-logo-schema";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

// Tentativas de tamanho máximo, da mais nítida para a mais leve, até caber no limite.
const MAX_BOXES: [number, number][] = [
  [600, 300],
  [400, 200],
  [300, 150],
  [200, 100],
];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    image.src = src;
  });
}

/**
 * Converte o arquivo escolhido pelo usuário em um PNG pequeno (data URL), pronto para
 * ser salvo nas configurações da loja. PNG mantém fundo transparente e é o formato
 * aceito pelo servidor e embutido nas planilhas.
 */
export async function imageFileToLogoDataUrl(file: File): Promise<string> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error("Formato não suportado. Use PNG, JPG ou WebP.");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("Não foi possível ler as dimensões da imagem.");
    }

    for (const [maxWidth, maxHeight] of MAX_BOXES) {
      const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Seu navegador não conseguiu processar a imagem.");
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL("image/png");
      if (dataUrl.length <= STORE_LOGO_MAX_LENGTH) return dataUrl;
    }

    throw new Error("Imagem muito detalhada para usar como logo. Tente uma versão mais simples.");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
