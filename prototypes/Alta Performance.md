---

version: "alpha"

name: "Estilo de Computação de Alta Performance"

description: "Powerful and technical landing page for new server processors. Ideal for landing pages, modern websites. AI-ready template."

colors:

  primary: "#ED1C24"

  secondary: "#000000"

  tertiary: "#FFFFFF"

  neutral: "#333333"

  surface: "#C0C0C0"

  accent: "#00BFFF"

typography:

  h1:

    fontFamily: Roboto

    fontSize: 2.5rem

    fontWeight: 700

  body-md:

    fontFamily: Roboto

    fontSize: 1rem

    fontWeight: 400

components:

  button-primary:

    backgroundColor: "{colors.primary}"

    textColor: "{colors.neutral}"

    padding: 12px

---

## Overview

Powerful and technical landing page for new server processors. Ideal for landing pages, modern websites. AI-ready template. The visual language of high performance computing didn't emerge from design studios. It came from engineering floors, from the need to make invisible power tangible. NVIDIA's green-black palette wasn't arbitrary — it was born from terminal screens and circuit boards, then weaponized into brand identity. AMD went red and angular. Intel stayed blue and clinical. All three arrived at the same conclusion: raw computation needs a visual proxy, something that says 'this thing thinks faster than you.'

The data center aesthetic solidified in the mid-2010s when cloud providers started marketing infrastructure directly. Suddenly, rows of blinking servers became hero images. The visual vocabulary crystallized: deep blacks, electric accent colors, wireframe geometries suggesting parallel pathways, and that specific glow — always a glow — implying energy being converted into intelligence. It's theatrical, sure. But it works because it maps to something real: the sublime scale of coordinated silicon.

What's interesting is how this style borrowed from sci-fi while simultaneously making sci-fi look quaint. The actual inside of an H100 cluster is more visually compelling than most movie sets. Designers figured that out.

- Density: 7/10 — Compact

- Variance: 4/10 — Moderate

- Motion: 4/10 — Subtle

- **Style:** Powerful, Technical, Modern

- **Keywords:** processors, GPUs, data center, high performance, technical, modern, efficient, scalable, reliable, cutting-edge

- **Era:** 2026+ HPC Dominance

- **Light/Dark:** ✗ No / ✓ Full

## Colors

- **Vermelho Performance** (#ED1C24) — Error states, destructive actions

- **Preto** (#000000) — Dark surface, primary background

- **Branco** (#FFFFFF) — Light surface, card backgrounds

- **Cinza Escuro** (#333333) — Dark surface, primary background

- **Prata** (#C0C0C0) — Extended palette, decorative use

- **Azul Elétrico** (#00BFFF) — Secondary accent

- **Verde** (#00FF00) — Success states, positive indicators

- **Cinza Claro** (#CCCCCC) — Secondary text, borders, muted elements

## Typography

- **Display / Hero:** Roboto — Weight 700, tight tracking, used for headline impact

- **Body:** Roboto — Weight 400, 16px/1.6 line-height, max 72ch per line

- **UI Labels / Captions:** Roboto — 0.875rem, weight 500, slight letter-spacing

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

Visualizações de desempenho de chips, diagramas de arquitetura de processadores, brilhos sutis em elementos de alta performance, tipografia técnica e ousada, micro-interações de dados em tempo real, elementos modulares, animações de fluxo de dados e calor.

- **Physics:** Ease-out curves, 200-300ms duration. Smooth and predictable.

- **Entry animations:** Fade + translate-Y (16px → 0) over 420ms ease-out. Staggered cascades for lists: 80ms between items.

- **Hover states:** Subtle color shift + shadow adjustment over 200ms.

- **Page transitions:** Fade only (200ms).

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

- No pure black (#000000) — use off-black or charcoal variants

- No oversaturated accent colors (saturation cap: 80%)

- No 3-column equal-width feature layouts — use zig-zag or asymmetric grid

- No `h-screen` — use `min-h-[100dvh]`

- No AI copywriting clichés: "Elevate", "Seamless", "Unleash", "Next-Gen"

- No broken external image links — use [picsum.photos](http://picsum.photos) or inline SVG

- No generic lorem ipsum in demos

- Do Visualizações de desempenho

- Do Diagramas de arquitetura

- Do Brilhos de alta performance

- Do Tipografia técnica

- Do Micro-interações de dados

- Do Animações de fluxo de calor.

## Use Case

Landing pages, Modern websites

