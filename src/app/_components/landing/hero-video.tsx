type VideoSource = {
  readonly src: string;
  readonly type: string;
};

type HeroVideoProps = {
  /** En orden de preferencia: el navegador usa la primera que soporte (WebM antes que MP4). */
  readonly sources: readonly VideoSource[];
  /** Imagen previa y alternativa estática si el usuario prefiere menos movimiento. */
  readonly poster: string;
  /** Encuadre del video dentro del recuadro (`object-position`), p. ej. "50% 62%". */
  readonly focus?: string;
  /** Clases de máscara para fundir los bordes con el fondo; por defecto, los cuatro lados. */
  readonly mask?: string;
  readonly className?: string;
};

/*
 * Funde los bordes del video con el fondo de la página: dos degradados
 * (vertical y horizontal) que se intersecan, sin colores propios. El borde
 * superior se difumina tanto como el inferior para que el recorte no se note.
 */
export const EDGE_MASK =
  "[mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent),linear-gradient(to_right,transparent,black_10%,black_90%,transparent)] [mask-composite:intersect]";

/**
 * Video decorativo en bucle para la portada. Se reproduce solo, sin sonido ni
 * controles; con `prefers-reduced-motion` se muestra únicamente el poster.
 * Es un componente de servidor: no necesita JavaScript en el navegador.
 */
export function HeroVideo({
  sources,
  poster,
  focus = "50% 50%",
  mask = EDGE_MASK,
  className = "",
}: HeroVideoProps) {
  const media = `h-full w-full object-cover ${mask}`;

  return (
    <div aria-hidden="true" className={`relative overflow-hidden ${className}`}>
      <video
        autoPlay
        className={`${media} motion-reduce:hidden`}
        disablePictureInPicture
        loop
        muted
        playsInline
        poster={poster}
        preload="metadata"
        style={{ objectPosition: focus }}
        tabIndex={-1}
      >
        {sources.map((source) => (
          <source key={source.src} src={source.src} type={source.type} />
        ))}
      </video>
      {/* eslint-disable-next-line @next/next/no-img-element -- imagen estática alternativa al video, sin optimizar */}
      <img
        alt=""
        className={`${media} hidden motion-reduce:block`}
        decoding="async"
        src={poster}
        style={{ objectPosition: focus }}
      />
    </div>
  );
}
