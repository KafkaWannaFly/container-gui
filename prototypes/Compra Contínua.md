---

version: "alpha"

name: "Estilo de Experiência de Compra Contínua"

description: "Functional and trustworthy landing page for a premium subscription service. Ideal for landing pages, modern websites. AI-ready template."

colors:

  primary: "#FF9900"

  secondary: "#000000"

  tertiary: "#FFFFFF"

  neutral: "#232F3E"

  surface: "#DDDDDD"

  accent: "#00A8E1"

typography:

  h1:

    fontFamily: Verdana

    fontSize: 2.5rem

    fontWeight: 700

  body-md:

    fontFamily: Verdana

    fontSize: 1rem

    fontWeight: 400

rounded:

  sm: 3px

  md: 6px

  lg: 9px

components:

  button-primary:

    backgroundColor: "{colors.primary}"

    textColor: "{colors.neutral}"

    rounded: "{[rounded.sm](http://rounded.sm)}"

    padding: 12px

---

## Overview

Functional and trustworthy landing page for a premium subscription service. Ideal for landing pages, modern websites. AI-ready template. Before Amazon patented one-click in 1999, buying online felt like filling out a mortgage application. That single patent rewired how an entire industry thinks about friction. Suddenly, every unnecessary form field was a leak in the funnel. Checkout UX became its own discipline — not a subfield of information architecture, but a craft obsessed with milliseconds and micro-decisions.

The visual language followed. Trust badges, progress indicators, persistent cart totals — these weren't decorative choices. They were answers to anxiety. Early e-commerce looked like a catalog stapled to a database. The shift toward seamless commerce demanded a new aesthetic: one where logistics infrastructure becomes invisible and the interface feels less like software, more like intention made tangible.

Omnichannel pushed it further. When a cart persists from phone to laptop to physical store, the design system isn't styling pages anymore — it's maintaining continuity across realities. The futuristic layer isn't about looking sci-fi. It's about making distributed cloud systems feel like a single, breathing surface.

- Density: 5/10 — Balanced

- Variance: 4/10 — Moderate

- Motion: 4/10 — Subtle

- **Style:** Functional, Trustworthy, Scalable

- **Keywords:** e-commerce, cloud, logistics, autonomous delivery, customer-centric, reliable, efficient, vast, seamless, modern

- **Era:** 2026+ E-commerce Evolution

- **Light/Dark:** ✓ Full / ✗ No

## Colors

- **Laranja Varejo** (#FF9900) — Warm accent, call-to-action secondary

- **Preto** (#000000) — Dark surface, primary background

- **Branco** (#FFFFFF) — Light surface, card backgrounds

- **Cinza Escuro** (#232F3E) — Dark surface, primary background

- **Cinza Claro** (#DDDDDD) — Secondary text, borders, muted elements

- **Verde-azulado** (#00A8E1) — Success states, positive indicators

- **Verde** (#008000) — Success states, positive indicators

- **Dourado** (#FFD700) — Premium accent, decorative highlights

## Typography

- **Display / Hero:** Verdana — Weight 700, tight tracking, used for headline impact

- **Body:** Verdana — Weight 400, 16px/1.6 line-height, max 72ch per line

- **UI Labels / Captions:** Verdana — 0.875rem, weight 500, slight letter-spacing

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

Layouts limpos e focados no produto, micro-interações de compra, animações de carregamento eficientes, tipografia clara (sans-serif), elementos de confiança (selos, avaliações), visualizações de rota de entrega, transições suaves.

- **Physics:** Ease-out curves, 200-300ms duration. Smooth and predictable.

- **Entry animations:** Fade + translate-Y (16px → 0) over 420ms ease-out. Staggered cascades for lists: 80ms between items.

- **Hover states:** Subtle color shift + shadow adjustment over 200ms.

- **Page transitions:** Fade only (200ms).

- **Performance:** Only transform and opacity animated. No layout-triggering properties.

## Shapes

Base corner radius: 3px. See rounded tokens in front matter for the full scale.

## Components

- **Primary Button:** Rounded (3px) shape. Accent color fill. Hover: 8% darken + subtle lift shadow. Active: -1px translate tactile press. Font weight 600. No outer glows.

- **Secondary / Ghost Button:** Outline variant. 1.5px border in muted color. Text in primary color. Hover: subtle background fill.

- **Cards:** Rounded (3px) corners. Surface background. Subtle shadow (0 2px 12px rgba(0,0,0,0.06)). 1px border stroke.

- **Inputs:** Label above input. 1px border stroke. Focus ring: 2px accent color offset 2px. Error text below in semantic red. No floating labels.

- **Navigation:** Primary surface background. Active item: accent color indicator. Font weight 500 when active.

- **Skeletons:** Shimmer animation matching component dimensions. No circular spinners.

- **Empty States:** Icon-based composition with descriptive text and action button.

## Do's and Don'ts

- No emojis in UI — use icon system only (Lucide, Heroicons)

- No pure black (#000000) — use off-black or charcoal variants

- No oversaturated accent colors (saturation cap: 80%)

- No 3-column equal-width feature layouts — use zig-zag or asymmetric grid

- No `h-screen` — use `min-h-[100dvh]`

- No AI copywriting clichés: "Elevate", "Seamless", "Unleash", "Next-Gen"

- No broken external image links — use [picsum.photos](http://picsum.photos) or inline SVG

- No generic lorem ipsum in demos

- Do Layouts focados no produto

- Do Micro-interações de compra

- Do Animações eficientes

- Do Tipografia clara

- Do Elementos de confiança

- Do Visualizações de entrega.

## Use Case

Landing pages, Modern websites

