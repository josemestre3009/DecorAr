import { PrepararVistaARUseCase } from "@/modules/ar/application/use-cases/preparar-vista-ar.use-case";
import { FabricaActivos3D } from "@/modules/ar/domain/fabrica-activos-3d";

/**
 * Una sola fábrica de activos por pestaña: volver a abrir un módulo, o abrir
 * otra copia del mismo, reutiliza el activo compartido (Flyweight) en lugar de
 * crear otro con las mismas URLs.
 */
export const fabricaActivos3D = new FabricaActivos3D();

export const prepararVistaAR = new PrepararVistaARUseCase(fabricaActivos3D);
