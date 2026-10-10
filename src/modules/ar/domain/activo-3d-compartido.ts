import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";

/**
 * Datos de un activo 3D tal como los publica el catálogo (DECOR-28/36).
 * Las dimensiones están en metros y describen el bounding box real del modelo.
 */
export interface DatosActivo3D {
  readonly assetId: string;
  readonly version: number;
  readonly glbUrl: string;
  readonly usdzUrl: string;
  readonly posterUrl: string | null;
  readonly widthM: number;
  readonly heightM: number;
  readonly depthM: number;
}

/**
 * Flyweight: estado intrínseco y costoso de un modelo 3D (URLs, poster y
 * dimensiones). Se comparte entre todas las instancias decorativas que lo usan,
 * por eso es inmutable: ninguna instancia puede alterar lo que ven las demás.
 */
export interface Activo3DCompartido extends DatosActivo3D {
  /** Identidad del flyweight: `assetId` + `version`. */
  readonly clave: string;
}

export function claveActivo3D(assetId: string, version: number): string {
  return `${assetId}@v${version}`;
}

export function crearActivo3DCompartido(
  datos: DatosActivo3D,
): Result<Activo3DCompartido, DomainError> {
  const assetId = datos.assetId.trim();

  if (assetId.length === 0) {
    return err(new DomainError("ar.invalid_asset_id", "El activo 3D no tiene identificador."));
  }

  if (!Number.isInteger(datos.version) || datos.version < 1) {
    return err(new DomainError("ar.invalid_version", "La versión del activo 3D no es válida."));
  }

  if (!esUrlSegura(datos.glbUrl)) {
    return err(new DomainError("ar.invalid_glb_url", "El modelo GLB no tiene una URL HTTPS válida."));
  }

  if (!esUrlSegura(datos.usdzUrl)) {
    return err(new DomainError("ar.invalid_usdz_url", "El modelo USDZ no tiene una URL HTTPS válida."));
  }

  if (datos.posterUrl !== null && !esUrlSegura(datos.posterUrl)) {
    return err(new DomainError("ar.invalid_poster_url", "El poster no tiene una URL HTTPS válida."));
  }

  for (const medida of [datos.widthM, datos.heightM, datos.depthM]) {
    if (!Number.isFinite(medida) || medida <= 0) {
      return err(
        new DomainError(
          "ar.invalid_dimension",
          "Las dimensiones del activo 3D deben ser números mayores que 0.",
        ),
      );
    }
  }

  return ok(
    Object.freeze({
      assetId,
      clave: claveActivo3D(assetId, datos.version),
      depthM: datos.depthM,
      glbUrl: datos.glbUrl,
      heightM: datos.heightM,
      posterUrl: datos.posterUrl,
      usdzUrl: datos.usdzUrl,
      version: datos.version,
      widthM: datos.widthM,
    }),
  );
}

/** Mismo activo: igual en todos los campos intrínsecos. */
export function mismosDatosActivo3D(activo: Activo3DCompartido, datos: DatosActivo3D): boolean {
  return (
    activo.assetId === datos.assetId.trim() &&
    activo.version === datos.version &&
    activo.glbUrl === datos.glbUrl &&
    activo.usdzUrl === datos.usdzUrl &&
    activo.posterUrl === datos.posterUrl &&
    activo.widthM === datos.widthM &&
    activo.heightM === datos.heightM &&
    activo.depthM === datos.depthM
  );
}

/**
 * Los visores nativos (Quick Look, Scene Viewer) descargan el archivo por su
 * cuenta y no aceptan contenido mixto: solo se admiten URLs absolutas HTTPS.
 */
function esUrlSegura(valor: string): boolean {
  try {
    return new URL(valor).protocol === "https:";
  } catch {
    return false;
  }
}
