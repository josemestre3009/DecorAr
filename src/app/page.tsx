import Image from "next/image";
import Link from "next/link";

import { HeroVideo } from "./_components/landing/hero-video";

// Vertical para celular; 16:9 para PC (desde lg), donde ocupa la columna derecha.
const HERO_SOURCES = [
  { src: "/landing/ar-glasses.webm", type: "video/webm" },
  { src: "/landing/ar-glasses.mp4", type: "video/mp4" },
] as const;

const HERO_WIDE_SOURCES = [
  { src: "/landing/ar-glasses-wide.webm", type: "video/webm" },
  { src: "/landing/ar-glasses-wide.mp4", type: "video/mp4" },
] as const;

// En PC el sujeto queda centrado con aire a los lados: los costados se
// difuminan más que en celular para que el recuadro no se note.
const WIDE_MASK =
  "[mask-image:linear-gradient(to_bottom,transparent,black_16%,black_84%,transparent),linear-gradient(to_right,transparent,black_24%,black_76%,transparent)] [mask-composite:intersect]";

// En celular el video va más pequeño y centrado, con los cuatro bordes
// difuminados. `darken` lleva al color del fondo cualquier píxel del video más
// claro que la página: desaparece la diferencia de tono del fondo del video y
// solo quedan la silla, las gafas y la proyección.
const MOBILE_MASK =
  "[mask-image:linear-gradient(to_bottom,transparent,black_12%,black_82%,transparent),linear-gradient(to_right,transparent,black_12%,black_88%,transparent)] [mask-composite:intersect] mix-blend-darken";

/** Marco de esquinas con "AR", como el del logo; decorativo. */
function ArFrameIcon() {
  return (
    <svg aria-hidden="true" className="size-6 shrink-0" fill="none" viewBox="0 0 24 24">
      <path
        d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
      <text
        fill="currentColor"
        fontFamily="inherit"
        fontSize="7.5"
        fontWeight="600"
        textAnchor="middle"
        x="12"
        y="14.6"
      >
        AR
      </text>
    </svg>
  );
}

export default function Home() {
  return (
    <main className="min-h-dvh overflow-x-hidden bg-decor-bg font-decor text-decor-ink">
      <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col items-center justify-center px-6 py-8 lg:grid lg:min-h-dvh lg:max-w-6xl lg:grid-cols-2 lg:items-center lg:gap-12 lg:px-12 lg:py-10">
        <HeroVideo
          className="aspect-[3/4] max-h-[48svh] w-[80%] lg:hidden"
          focus="50% 62%"
          mask={MOBILE_MASK}
          poster="/landing/poster.webp"
          sources={HERO_SOURCES}
        />

        <div className="flex w-full flex-col items-center text-center lg:items-start lg:text-left">
          <div className="relative z-10 -mt-6 flex w-full items-start gap-4 lg:mt-0">
            <span aria-hidden="true" className="mt-[1.65rem] h-px flex-1 bg-decor-line lg:hidden" />
            <Image
              alt="DecorAR"
              className="h-[4.5rem] w-auto lg:h-24"
              height={240}
              priority
              src="/landing/logo.webp"
              width={242}
            />
            <span aria-hidden="true" className="mt-[1.65rem] h-px flex-1 bg-decor-line lg:mt-[2.2rem]" />
          </div>

          <h1 className="mt-4 text-[1.875rem] leading-[1.15] font-normal tracking-[-0.02em] text-balance lg:mt-10 lg:text-[3.25rem] lg:leading-[1.08]">
            Tu evento, tu realidad <span className="block text-decor-copper">aumentada</span>
          </h1>

          <p className="mt-3 max-w-[22rem] text-[0.95rem] leading-relaxed text-decor-ink-soft lg:mt-5 lg:max-w-md lg:text-lg">
            Escanea tu espacio y decora con muebles y adornos en 3D antes de reservar.
          </p>

          {/* Sin sesión, el proxy lleva a /login y el login regresa a /packages. */}
          <Link
            className="mt-6 inline-flex min-h-14 items-center gap-3 rounded-full bg-decor-copper px-8 py-3 text-base font-medium text-white no-underline shadow-[0_8px_24px_-12px_var(--color-decor-copper-dark)] transition duration-150 hover:bg-decor-copper-dark focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-decor-ink active:scale-[0.98] active:bg-decor-copper-dark motion-reduce:transition-none motion-reduce:active:scale-100 lg:mt-9"
            href="/packages"
          >
            Empezar a Decorar
            <ArFrameIcon />
          </Link>

          <Link
            className="mt-4 rounded-sm px-1 text-base font-medium text-decor-ink underline underline-offset-4 hover:text-decor-copper-dark focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-decor-copper lg:mt-5 lg:px-0"
            href="/login"
          >
            Inicia Sesión
          </Link>
        </div>

        <HeroVideo
          className="hidden aspect-square max-h-[80svh] w-full lg:block"
          mask={WIDE_MASK}
          poster="/landing/poster-wide.webp"
          sources={HERO_WIDE_SOURCES}
        />
      </div>
    </main>
  );
}
