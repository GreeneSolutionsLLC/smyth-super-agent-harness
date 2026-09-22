// ── Design Reference Library ──
// Smyth's curated collection of design templates and patterns.
// Each template packs real design opinions — not boilerplate.

export interface DesignTemplate {
  id: string;
  name: string;
  category: "enterprise-saas" | "creative-agency" | "startup-minimal";
  description: string;
  bestFor: string[];
  layout: "single-scroll" | "multi-page" | "landing";
  features: string[];
  colorMood: string;
  typographyPair: string;
  html: string;
}

// ── Template: Enterprise SaaS - Simple Landing ──

const ENTERPRISE_LANDING = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{SITE_NAME}} — {{TAGLINE}}</title>
  <style>
    :root {
      --primary: {{PRIMARY}};
      --secondary: {{SECONDARY}};
      --accent: {{ACCENT}};
      --bg: {{BACKGROUND}};
      --surface: {{SURFACE}};
      --text: {{TEXT}};
      --muted: {{MUTED}};
      --radius: {{BORDER_RADIUS}};
      --shadow-sm: {{SHADOW_SM}};
      --shadow-md: {{SHADOW_MD}};
      --shadow-lg: {{SHADOW_LG}};
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: {{BODY_FONT}};
      color: var(--text);
      background: var(--bg);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    h1, h2, h3, h4 {
      font-family: {{HEADING_FONT}};
      line-height: 1.2;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    /* ── Navigation ── */
    nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 2rem;
      max-width: 1200px;
      margin: 0 auto;
    }
    .logo {
      font-family: {{HEADING_FONT}};
      font-weight: 800;
      font-size: 1.5rem;
      color: var(--primary);
      text-decoration: none;
    }
    .nav-links {
      display: flex;
      gap: 2rem;
      align-items: center;
    }
    .nav-links a {
      color: var(--muted);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 500;
      transition: color 0.2s;
    }
    .nav-links a:hover { color: var(--text); }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1.5rem;
      border-radius: var(--radius);
      font-weight: 600;
      font-size: 0.9rem;
      text-decoration: none;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .btn-primary {
      background: var(--primary);
      color: white;
    }
    .btn-primary:hover {
      opacity: 0.9;
      transform: translateY(-1px);
      box-shadow: var(--shadow-md);
    }
    .btn-secondary {
      background: transparent;
      color: var(--primary);
      border: 2px solid var(--primary);
    }
    .btn-secondary:hover {
      background: var(--primary);
      color: white;
    }

    /* ── Hero ── */
    .hero {
      max-width: 1200px;
      margin: 4rem auto;
      padding: 0 2rem;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4rem;
      align-items: center;
    }
    .hero-content h1 {
      font-size: 3.5rem;
      margin-bottom: 1.5rem;
      color: var(--text);
    }
    .hero-content h1 span {
      color: var(--accent);
    }
    .hero-content p {
      font-size: 1.15rem;
      color: var(--muted);
      margin-bottom: 2rem;
      max-width: 480px;
    }
    .hero-actions {
      display: flex;
      gap: 1rem;
    }
    .hero-visual {
      background: var(--surface);
      border-radius: var(--radius);
      padding: 3rem;
      text-align: center;
      border: 1px solid rgba(0,0,0,0.06);
      box-shadow: var(--shadow-lg);
      min-height: 320px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .hero-visual .placeholder-graphic {
      width: 100%;
      height: 200px;
      background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
      border-radius: var(--radius);
      opacity: 0.15;
    }

    /* ── Trust Bar ── */
    .trust-bar {
      background: var(--surface);
      padding: 3rem 2rem;
      text-align: center;
    }
    .trust-bar p {
      font-size: 0.8rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 1.5rem;
    }
    .trust-logos {
      display: flex;
      justify-content: center;
      gap: 3rem;
      flex-wrap: wrap;
    }
    .trust-logos span {
      font-family: {{HEADING_FONT}};
      font-weight: 700;
      font-size: 1.2rem;
      color: var(--muted);
      opacity: 0.6;
    }

    /* ── Features ── */
    .features {
      max-width: 1200px;
      margin: 6rem auto;
      padding: 0 2rem;
    }
    .features h2 {
      text-align: center;
      font-size: 2.5rem;
      margin-bottom: 3rem;
    }
    .feature-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2rem;
    }
    .feature-card {
      background: var(--surface);
      padding: 2rem;
      border-radius: var(--radius);
      border: 1px solid rgba(0,0,0,0.06);
      transition: all 0.2s;
    }
    .feature-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
    }
    .feature-card .icon {
      width: 48px;
      height: 48px;
      background: color-mix(in srgb, var(--accent) 15%, transparent);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1rem;
      font-size: 1.5rem;
    }
    .feature-card h3 {
      font-size: 1.1rem;
      margin-bottom: 0.5rem;
    }
    .feature-card p {
      font-size: 0.9rem;
      color: var(--muted);
      line-height: 1.5;
    }

    /* ── Testimonials ── */
    .testimonials {
      max-width: 1200px;
      margin: 6rem auto;
      padding: 0 2rem;
    }
    .testimonials h2 {
      text-align: center;
      font-size: 2.5rem;
      margin-bottom: 3rem;
    }
    .testimonial-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 2rem;
    }
    .testimonial-card {
      background: var(--surface);
      padding: 2rem;
      border-radius: var(--radius);
      border: 1px solid rgba(0,0,0,0.06);
    }
    .testimonial-card .quote {
      font-size: 0.95rem;
      color: var(--muted);
      font-style: italic;
      margin-bottom: 1rem;
    }
    .testimonial-card .author {
      font-weight: 600;
      font-size: 0.85rem;
    }
    .testimonial-card .role {
      font-size: 0.8rem;
      color: var(--muted);
    }

    /* ── CTA ── */
    .cta {
      background: var(--primary);
      color: white;
      text-align: center;
      padding: 5rem 2rem;
    }
    .cta h2 {
      font-size: 2.5rem;
      margin-bottom: 1rem;
      color: white;
    }
    .cta p {
      opacity: 0.8;
      margin-bottom: 2rem;
      max-width: 500px;
      margin-left: auto;
      margin-right: auto;
    }
    .cta .btn-primary {
      background: white;
      color: var(--primary);
    }
    .cta .btn-primary:hover {
      opacity: 0.9;
    }

    /* ── Footer ── */
    footer {
      max-width: 1200px;
      margin: 0 auto;
      padding: 3rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: var(--muted);
      font-size: 0.85rem;
    }
    footer .footer-links {
      display: flex;
      gap: 2rem;
    }
    footer a {
      color: var(--muted);
      text-decoration: none;
    }
    footer a:hover { color: var(--text); }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .hero { grid-template-columns: 1fr; gap: 2rem; }
      .hero-content h1 { font-size: 2.5rem; }
      .feature-grid { grid-template-columns: 1fr; }
      .testimonial-grid { grid-template-columns: 1fr; }
      nav { flex-direction: column; gap: 1rem; }
      .nav-links { flex-wrap: wrap; justify-content: center; gap: 1rem; }
    }
  </style>
</head>
<body>
  <!-- Navigation -->
  <nav>
    <a href="/" class="logo">{{SITE_NAME}}</a>
    <div class="nav-links">
      <a href="#features">Features</a>
      <a href="#testimonials">Testimonials</a>
      <a href="#contact">Contact</a>
      <a href="#" class="btn btn-primary">Book a Demo</a>
    </div>
  </nav>

  <!-- Hero -->
  <section class="hero">
    <div class="hero-content">
      <h1>{{HERO_HEADLINE}}</h1>
      <p>{{HERO_SUBTEXT}}</p>
      <div class="hero-actions">
        <a href="#" class="btn btn-primary">{{CTA_PRIMARY}}</a>
        <a href="#" class="btn btn-secondary">{{CTA_SECONDARY}}</a>
      </div>
    </div>
    <div class="hero-visual">
      <div class="placeholder-graphic"></div>
    </div>
  </section>

  <!-- Trust Bar -->
  <section class="trust-bar">
    <p>Trusted by leading organizations</p>
    <div class="trust-logos">
      <span>Company</span>
      <span>Organization</span>
      <span>Enterprise</span>
      <span>Business</span>
      <span>Corp</span>
    </div>
  </section>

  <!-- Features -->
  <section class="features" id="features">
    <h2>{{FEATURES_HEADING}}</h2>
    <div class="feature-grid">
      <div class="feature-card">
        <div class="icon">⚡</div>
        <h3>{{FEATURE_1_TITLE}}</h3>
        <p>{{FEATURE_1_DESC}}</p>
      </div>
      <div class="feature-card">
        <div class="icon">🛡️</div>
        <h3>{{FEATURE_2_TITLE}}</h3>
        <p>{{FEATURE_2_DESC}}</p>
      </div>
      <div class="feature-card">
        <div class="icon">📊</div>
        <h3>{{FEATURE_3_TITLE}}</h3>
        <p>{{FEATURE_3_DESC}}</p>
      </div>
    </div>
  </section>

  <!-- Testimonials -->
  <section class="testimonials" id="testimonials">
    <h2>{{TESTIMONIALS_HEADING}}</h2>
    <div class="testimonial-grid">
      <div class="testimonial-card">
        <div class="quote">{{QUOTE_1}}</div>
        <div class="author">{{AUTHOR_1}}</div>
        <div class="role">{{ROLE_1}}</div>
      </div>
      <div class="testimonial-card">
        <div class="quote">{{QUOTE_2}}</div>
        <div class="author">{{AUTHOR_2}}</div>
        <div class="role">{{ROLE_2}}</div>
      </div>
    </div>
  </section>

  <!-- CTA -->
  <section class="cta" id="contact">
    <h2>{{CTA_HEADING}}</h2>
    <p>{{CTA_SUBTEXT}}</p>
    <a href="#" class="btn btn-primary">{{CTA_BUTTON}}</a>
  </section>

  <!-- Footer -->
  <footer>
    <span>© 2026 {{SITE_NAME}}. All rights reserved.</span>
    <div class="footer-links">
      <a href="#">Privacy</a>
      <a href="#">Terms</a>
      <a href="#">Contact</a>
    </div>
  </footer>
</body>
</html>`;

// ── Template: Creative Agency - Dark Theme ──

const CREATIVE_DARK = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{SITE_NAME}} — {{TAGLINE}}</title>
  <style>
    :root {
      --primary: {{PRIMARY}};
      --secondary: {{SECONDARY}};
      --accent: {{ACCENT}};
      --bg: #0a0a0b;
      --surface: #141416;
      --text: #fafafa;
      --muted: #888;
      --radius: {{BORDER_RADIUS}};
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: {{BODY_FONT}};
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    h1, h2, h3 { font-family: {{HEADING_FONT}}; line-height: 1.15; font-weight: 800; letter-spacing: -0.03em; }

    nav {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1.5rem 2rem; max-width: 1400px; margin: 0 auto;
    }
    .logo { font-weight: 800; font-size: 1.3rem; color: var(--text); text-decoration: none; letter-spacing: -0.02em; }
    .nav-links { display: flex; gap: 2.5rem; align-items: center; }
    .nav-links a { color: var(--muted); text-decoration: none; font-size: 0.85rem; font-weight: 500; transition: color 0.2s; }
    .nav-links a:hover { color: var(--text); }

    .hero {
      max-width: 1400px; margin: 6rem auto; padding: 0 2rem;
      display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; align-items: center;
    }
    .hero-badge {
      display: inline-flex; align-items: center; gap: 0.5rem;
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      color: var(--accent); padding: 0.4rem 1rem; border-radius: 100px;
      font-size: 0.8rem; font-weight: 600; margin-bottom: 1.5rem;
    }
    .hero h1 { font-size: 4rem; margin-bottom: 1.5rem; }
    .hero h1 span { background: linear-gradient(135deg, var(--accent), var(--primary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero p { color: var(--muted); font-size: 1.1rem; margin-bottom: 2rem; max-width: 480px; }
    .hero-visual {
      background: var(--surface); border-radius: var(--radius); padding: 2rem;
      border: 1px solid rgba(255,255,255,0.06); min-height: 400px;
      display: flex; align-items: center; justify-content: center;
      position: relative; overflow: hidden;
    }
    .hero-visual::before {
      content: ''; position: absolute; inset: 0;
      background: radial-gradient(circle at 30% 50%, color-mix(in srgb, var(--accent) 20%, transparent) 0%, transparent 60%);
    }
    .grid-overlay {
      display: grid; grid-template-columns: repeat(3,1fr); gap: 1rem; width: 100%;
      position: relative; z-index: 1;
    }
    .grid-cell { background: rgba(255,255,255,0.03); border-radius: calc(var(--radius) - 2px); padding: 1rem; aspect-ratio: 1; }

    .work { max-width: 1400px; margin: 8rem auto; padding: 0 2rem; }
    .work h2 { font-size: 3rem; margin-bottom: 3rem; }
    .work-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 1.5rem; }
    .work-item { background: var(--surface); border-radius: var(--radius); padding: 2rem; border: 1px solid rgba(255,255,255,0.06); transition: all 0.3s; }
    .work-item:hover { border-color: var(--accent); transform: translateY(-2px); }
    .work-item .tag { font-size: 0.7rem; color: var(--accent); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 0.5rem; }
    .work-item h3 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .work-item p { color: var(--muted); font-size: 0.9rem; }

    footer { text-align: center; padding: 3rem 2rem; color: var(--muted); font-size: 0.85rem; border-top: 1px solid rgba(255,255,255,0.06); }

    @media (max-width: 768px) {
      .hero { grid-template-columns: 1fr; margin: 3rem auto; }
      .hero h1 { font-size: 2.5rem; }
      .work-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <nav>
    <a href="/" class="logo">{{SITE_NAME}}</a>
    <div class="nav-links">
      <a href="#work">Work</a>
      <a href="#services">Services</a>
      <a href="#contact">Contact</a>
    </div>
  </nav>

  <section class="hero">
    <div>
      <div class="hero-badge">✦ {{BADGE_TEXT}}</div>
      <h1>{{HERO_HEADLINE}} <span>{{HERO_HIGHLIGHT}}</span></h1>
      <p>{{HERO_SUBTEXT}}</p>
      <a href="#" class="btn" style="display:inline-flex;align-items:center;gap:0.5rem;background:var(--accent);color:var(--bg);padding:0.85rem 2rem;border-radius:var(--radius);font-weight:700;text-decoration:none;font-size:0.9rem;">{{CTA_BUTTON}} →</a>
    </div>
    <div class="hero-visual">
      <div class="grid-overlay">
        <div class="grid-cell"></div>
        <div class="grid-cell"></div>
        <div class="grid-cell"></div>
        <div class="grid-cell"></div>
        <div class="grid-cell" style="background:rgba(255,255,255,0.06)"></div>
        <div class="grid-cell"></div>
      </div>
    </div>
  </section>

  <section class="work" id="work">
    <h2>{{WORK_HEADING}}</h2>
    <div class="work-grid">
      <div class="work-item">
        <div class="tag">Project</div>
        <h3>{{PROJECT_1_NAME}}</h3>
        <p>{{PROJECT_1_DESC}}</p>
      </div>
      <div class="work-item">
        <div class="tag">Project</div>
        <h3>{{PROJECT_2_NAME}}</h3>
        <p>{{PROJECT_2_DESC}}</p>
      </div>
    </div>
  </section>

  <footer>
    <p>© 2026 {{SITE_NAME}}. All rights reserved. {{FOOTER_TAGLINE}}</p>
  </footer>
</body>
</html>`;

// ── Template: Startup Minimal - One Pager ──

const STARTUP_MINIMAL = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{SITE_NAME}} — {{TAGLINE}}</title>
  <style>
    :root {
      --primary: {{PRIMARY}};
      --accent: {{ACCENT}};
      --bg: {{BACKGROUND}};
      --text: {{TEXT}};
      --muted: {{MUTED}};
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: {{BODY_FONT}};
      color: var(--text);
      background: var(--bg);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    h1, h2, h3 { font-family: {{HEADING_FONT}}; line-height: 1.2; font-weight: 700; }

    .page {
      max-width: 640px;
      margin: 0 auto;
      padding: 4rem 2rem;
    }

    .logo {
      font-weight: 800;
      font-size: 1.2rem;
      color: var(--text);
      margin-bottom: 6rem;
      display: block;
      text-decoration: none;
    }

    .hero h1 {
      font-size: 3rem;
      margin-bottom: 1.5rem;
    }
    .hero p {
      font-size: 1.15rem;
      color: var(--muted);
      margin-bottom: 2.5rem;
      max-width: 480px;
    }

    .inline-cta {
      display: inline-flex; align-items: center; gap: 0.75rem;
      background: var(--primary); color: white; padding: 0.85rem 2rem;
      border-radius: 6px; font-weight: 600; font-size: 0.95rem;
      text-decoration: none; transition: all 0.2s;
    }
    .inline-cta:hover { opacity: 0.9; }

    .section { margin-top: 6rem; }
    .section h2 { font-size: 1.5rem; margin-bottom: 1rem; }
    .section p, .section li { color: var(--muted); font-size: 0.95rem; }

    .section ul { list-style: none; padding: 0; }
    .section li { padding: 0.75rem 0; border-bottom: 1px solid rgba(0,0,0,0.05); display: flex; gap: 0.75rem; }
    .section li::before { content: "→"; color: var(--accent); font-weight: 700; }

    footer { margin-top: 6rem; padding-top: 2rem; border-top: 1px solid rgba(0,0,0,0.06); color: var(--muted); font-size: 0.85rem; display: flex; justify-content: space-between; }
    footer a { color: var(--text); text-decoration: none; }
    footer a:hover { text-decoration: underline; }

    @media (max-width: 480px) {
      .hero h1 { font-size: 2.2rem; }
      .page { padding: 2rem 1.5rem; }
    }
  </style>
</head>
<body>
  <div class="page">
    <a href="/" class="logo">{{SITE_NAME}}</a>

    <section class="hero">
      <h1>{{HERO_HEADLINE}}</h1>
      <p>{{HERO_SUBTEXT}}</p>
      <a href="#" class="inline-cta">{{CTA_TEXT}} →</a>
    </section>

    <section class="section">
      <h2>{{SECTION_1_HEADING}}</h2>
      <p>{{SECTION_1_CONTENT}}</p>
      <ul>
        <li>{{BULLET_1}}</li>
        <li>{{BULLET_2}}</li>
        <li>{{BULLET_3}}</li>
      </ul>
    </section>

    <section class="section">
      <h2>{{SECTION_2_HEADING}}</h2>
      <p>{{SECTION_2_CONTENT}}</p>
    </section>

    <footer>
      <span>© 2026 {{SITE_NAME}}</span>
      <a href="mailto:{{EMAIL}}">{{EMAIL}}</a>
    </footer>
  </div>
</body>
</html>`;

// ── Template Library ──

export const TEMPLATES: DesignTemplate[] = [
  {
    id: "enterprise-saas-landing",
    name: "Enterprise SaaS Landing",
    category: "enterprise-saas",
    description: "Clean B2B landing with hero, trust bar, features grid, testimonials, and CTA section.",
    bestFor: ["CRA / Background Screening", "Enterprise SaaS", "Professional Services"],
    layout: "single-scroll",
    features: ["Hero split layout", "Trust bar with logos", "3-column feature grid", "Testimonial cards", "Dark CTA section"],
    colorMood: "Professional / Trustworthy — deep blues and greens",
    typographyPair: "Inter (body) + Inter (headings)",
    html: ENTERPRISE_LANDING,
  },
  {
    id: "creative-agency-dark",
    name: "Creative Agency Dark",
    category: "creative-agency",
    description: "Modern dark-theme agency portfolio with gradient text and visual grid.",
    bestFor: ["Creative Agencies", "Design Studios", "Tech Startups", "Consulting"],
    layout: "single-scroll",
    features: ["Dark theme", "Gradient text hero", "Badge element", "Work/project grid", "Subtle glow effects"],
    colorMood: "Bold / Modern — dark background with vibrant accent",
    typographyPair: "Inter (body) + Inter (headings)",
    html: CREATIVE_DARK,
  },
  {
    id: "startup-minimal-one-pager",
    name: "Startup Minimal One-Pager",
    category: "startup-minimal",
    description: "Ultra-minimal single column layout with bullet list features. Content-first.",
    bestFor: ["Early-stage startups", "Product launches", "Personal brands", "Waitlist pages"],
    layout: "single-scroll",
    features: ["Centered column layout", "Minimal typography", "Bullet feature list", "Clean footer"],
    colorMood: "Clean / Minimal — light background, one accent color",
    typographyPair: "Inter (body) + Inter (headings)",
    html: STARTUP_MINIMAL,
  },
];

export function getTemplatesByIndustry(industry: string): DesignTemplate[] {
  return TEMPLATES.filter(t =>
    t.bestFor.some(target =>
      industry.toLowerCase().includes(target.toLowerCase()) ||
      target.toLowerCase().includes(industry.toLowerCase())
    )
  );
}

export function getAllTemplates(): DesignTemplate[] {
  return TEMPLATES;
}

export function getTemplateById(id: string): DesignTemplate | undefined {
  return TEMPLATES.find(t => t.id === id);
}

export function applyTemplate(
  template: DesignTemplate,
  values: Record<string, string>
): string {
  let output = template.html;
  for (const [key, val] of Object.entries(values)) {
    output = output.replace(new RegExp(`{{${key}}}`, "g"), val);
  }
  return output;
}
