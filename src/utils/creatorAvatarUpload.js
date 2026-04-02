/**
 * Avatar de criador: quadrado, saída WebP (~512px) para upload no Storage.
 */

const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
export const CREATOR_AVATAR_MAX_INPUT_BYTES = Math.floor(800 * 1024);
const OUTPUT_SIZE = 512;

export function validarArquivoAvatarCriador(file) {
  if (!file) return 'Selecione uma imagem para o avatar.';
  if (!IMAGE_TYPES.includes(file.type)) return 'Use JPG, PNG ou WEBP.';
  if (file.size > CREATOR_AVATAR_MAX_INPUT_BYTES) {
    return 'Imagem até 800KB.';
  }
  return '';
}

function carregarImagem(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a imagem.'));
    };
    img.src = url;
  });
}

function canvasParaWebpBlob(canvas, quality = 0.88) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Não foi possível gerar o WebP.'));
        else resolve(blob);
      },
      'image/webp',
      quality
    );
  });
}

/**
 * Recorta ao centro (cover) em quadrado e exporta WebP.
 * @param {File} file
 * @returns {Promise<Blob>}
 */
export async function processCreatorAvatarFileToWebp(file) {
  const err = validarArquivoAvatarCriador(file);
  if (err) throw new Error(err);
  const img = await carregarImagem(file);
  const sw = Number(img.naturalWidth || img.width || 0);
  const sh = Number(img.naturalHeight || img.height || 0);
  if (!sw || !sh) throw new Error('Imagem inválida.');

  const side = Math.min(sw, sh);
  const sx = Math.floor((sw - side) / 2);
  const sy = Math.floor((sh - side) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível.');
  ctx.drawImage(img, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

  let q = 0.9;
  let blob = await canvasParaWebpBlob(canvas, q);
  const maxOut = 180 * 1024;
  while (blob.size > maxOut && q > 0.45) {
    q -= 0.07;
    blob = await canvasParaWebpBlob(canvas, q);
  }
  return blob;
}
