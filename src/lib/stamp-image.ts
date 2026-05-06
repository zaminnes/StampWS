import { HttpError } from "./http";

export function validateStampImage(dataUrl: string) {
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
    throw new HttpError(400, "도장 이미지는 PNG/JPEG/WebP data URL이어야 합니다.");
  }
  if (dataUrl.length > 350_000) {
    throw new HttpError(413, "도장 이미지가 너무 큽니다. 작은 캔버스로 저장하세요.");
  }
  return dataUrl;
}
