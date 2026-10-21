---

version: "alpha"

name: "Estilo de Entretenimento Imersivo"

description: "Cinematic and engaging landing page for a new interactive series. Ideal for landing pages, modern websites. AI-ready template."

colors:

  primary: "#E50914"

  secondary: "#000000"

  tertiary: "#FFFFFF"

  neutral: "#222222"

  surface: "#FFD700"

  accent: "#800080"

typography:

  h1:

    fontFamily: Helvetica

    fontSize: 2.5rem

    fontWeight: 700

  body-md:

    fontFamily: Helvetica

    fontSize: 1rem

    fontWeight: 400

components:

  button-primary:

    backgroundColor: "{colors.primary}"

    textColor: "{colors.neutral}"

    padding: 12px

---

## Overview

Cinematic and engaging landing page for a new interactive series. Ideal for landing pages, modern websites. AI-ready template. Netflix didn't invent the dark UI. But they made it law. Around 2013, when the platform shifted from DVD-by-mail afterthought to streaming behemoth, their interface crystallized into something unmistakable: black canvas, oversized thumbnails, horizontal carousels that begged you to keep scrolling. The chrome disappeared. Navigation shrank to near-nothing. Content became the interface itself.

Disney+ arrived later and doubled down — adding cinematic hero banners that auto-played trailers before you'd even decided what to watch. The message was clear: you're not using software, you're entering a theater. Every pixel serves the content or gets out of the way.

This pattern spread everywhere. Spotify adopted it for music. YouTube for creators. Gaming platforms like Xbox and PlayStation rebuilt their dashboards around it. The formula is deceptively simple — dark backgrounds reduce eye strain during long sessions, large imagery creates emotional pull, and minimal UI chrome keeps the brain in consumption mode rather than navigation mode. It works because it respects what people came for: the content, not the container.

- Density: 5/10 — Balanced

- Variance: 4/10 — Moderate

- Motion: 8/10 — Cinematic

- **Style:** Cinematic, Engaging, Personalized

- **Keywords:** streaming, entertainment, interactive, AI, cinematic, engaging, personalized, dark mode, dynamic, immersive

- **Era:** 2026+ Interactive Storytelling

- **Light/Dark:** ✗ No / ✓ Full

## Colors

- **Vermelho Streaming** (#E50914) — Error states, destructive actions

- **Preto** (#000000) — Dark surface, primary background

- **Branco** (#FFFFFF) — Light surface, card backgrounds

- **Cinza Escuro** (#222222) — Dark surface, primary background

- **Dourado** (#FFD700) — Premium accent, decorative highlights

- **Roxo** (#800080) — Accent color, emphasis elements

- **Azul** (#0000FF) — Secondary accent

- **Cinza Claro** (#CCCCCC) — Secondary text, borders, muted elements

## Typography

- **Display / Hero:** Helvetica — Weight 700, tight tracking, used for headline impact

- **Body:** Helvetica — Weight 400, 16px/1.6 line-height, max 72ch per line

- **UI Labels / Captions:** Helvetica — 0.875rem, weight 500, slight letter-spacing

- **Monospace:** JetBrains Mono — Used for code, metadata, and technical values

Scale:

- Hero: clamp(2.5rem, 5vw, 4rem)

- H1: 2.25rem

- H2: 1.5rem

- Body: 1rem / 1.6

- Small: 0.875rem

## Layout

- **Grid:** CSS Grid primary. Max-width containment: 1280px centered with 1.5rem side padding.

- **Spacing rhythm:** Balanced. Base unit: 0.5rem (8px).

- **Section vertical gaps:** clamp(4rem, 8vw, 8rem).

- **Hero layout:** Split-screen (text left, visual right).

- **Feature sections:** Zig-zag alternating text+image rows. No 3-equal-columns.

- **Mobile collapse:** All multi-column layouts collapse below 768px. No horizontal overflow.

- **z-index contract:** base (0) / sticky-nav (100) / overlay (200) / modal (300) / toast (500).

## Elevation &amp; Depth

Backgrounds de vídeo em loop, capas de filmes dinâmicas, micro-interações de seleção de conteúdo, tipografia ousada (sans-serif), elementos de recomendação personalizada, transições cinematográficas, efeitos de desfoque e foco.

- **Physics:** Spring — stiffness 120, damping 20. Confident, weighted transitions.

- **Entry animations:** Fade + translate-Y (16px → 0) over 540ms ease-out. Staggered cascades for lists: 120ms between items.

- **Hover states:** Scale(1.03) + shadow lift over 200ms.

- **Page transitions:** Fade + slide (300ms).

- **Performance:** Only transform and opacity animated. No layout-triggering properties.

## Shapes

Base corner radius: 8px. See rounded tokens in front matter for the full scale.

## Components

- **Primary Button:** Subtly rounded (0.5rem) shape. Accent color fill. Hover: 8% darken + subtle lift shadow. Active: -1px translate tactile press. Font weight 600. No outer glows.

- **Secondary / Ghost Button:** Outline variant. 1.5px border in muted color. Text in primary color. Hover: subtle background fill.

- **Cards:** Subtly rounded (0.5rem) corners. Surface background. Subtle shadow (0 2px 12px rgba(0,0,0,0.06)). 1px border stroke.

- **Inputs:** Label above input. 1px border stroke. Focus ring: 2px accent color offset 2px. Error text below in semantic red. No floating labels.

- **Navigation:** Primary surface background. Active item: accent color indicator. Font weight 500 when active.

- **Skeletons:** Shimmer animation matching component dimensions. No circular spinners.

- **Empty States:** Icon-based composition with descriptive text and action button.

## Do's and Don'ts

- No emojis in UI — use icon system only (Lucide, Heroicons)

- No pure white (#FFFFFF) backgrounds — use off-white or dark surfaces

- No oversaturated accent colors (saturation cap: 80%)

- No 3-column equal-width feature layouts — use zig-zag or asymmetric grid

- No `h-screen` — use `min-h-[100dvh]`

- No AI copywriting clichés: "Elevate", "Seamless", "Unleash", "Next-Gen"

- No broken external image links — use [picsum.photos](http://picsum.photos) or inline SVG

- No generic lorem ipsum in demos

- Do Background de vídeo em loop

- Do Capas de filmes dinâmicas

- Do Micro-interações de seleção

- Do Tipografia ousada

- Do Recomendações personalizadas

- Do Transições cinematográficas.

## Use Case

Landing pages, Modern websites

