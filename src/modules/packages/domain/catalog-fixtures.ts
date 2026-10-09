import type { ModuloDecoracion } from "./decoration-module";

export const CATALOGO_CANONICO: {
  readonly mesaRedonda: ModuloDecoracion;
  readonly arcoFloral: ModuloDecoracion;
  readonly pistaBaile: ModuloDecoracion;
} = {
  mesaRedonda: {
    id: "mesa-redonda",
    nombre: "Mesa redonda x10",
    precio: 250000,
    ocupaM2: 4,
  },
  arcoFloral: {
    id: "arco-floral",
    nombre: "Arco floral de entrada",
    precio: 200000,
    ocupaM2: 2,
  },
  pistaBaile: {
    id: "pista-baile-4x4",
    nombre: "Pista de baile 4x4",
    precio: 600000,
    ocupaM2: 16,
  },
};
