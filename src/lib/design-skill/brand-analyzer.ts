// ── Brand Analysis — Extracts identity signals from existing site content ──
// Used by the Web Redesign skill to understand brand before designing.

export interface BrandProfile {
  name: string;
  tagline: string;
  industry: string;
  targetAudience: string[];
  tone: string;
  currentColors: string[];
  currentTypography: string[];
  layoutStyle: string;
  contentSections: string[];
  strengths: string[];
  weaknesses: string[];
}

export function extractBrandProfile(
  pageTitle: string,
  metaDescription: string,
  headingTexts: string[],
  bodyText: string,
  allLinks: string[]
): BrandProfile {
  // Infer industry from repeated keywords in text and links
  const fullText = [pageTitle, metaDescription, ...headingTexts, bodyText].join(" ").toLowerCase();

  const industry = inferIndustry(fullText, allLinks);
  const audience = inferAudience(fullText, industry);
  const tone = inferTone(fullText);
  const sections = inferSections(headingTexts);
  const strengths = inferStrengths(pageTitle, metaDescription, industry);
  const weaknesses = inferWeaknesses(fullText, strengths);

  return {
    name: pageTitle.split(" - ")[0] || pageTitle.split(" | ")[0] || "Unknown",
    tagline: metaDescription || "",
    industry,
    targetAudience: audience,
    tone,
    currentColors: [], // Can't extract from text alone, screenshot analysis needed
    currentTypography: [],
    layoutStyle: inferLayout(headingTexts),
    contentSections: sections,
    strengths,
    weaknesses,
  };
}

function inferIndustry(text: string, links: string[]): string {
  const patterns: Record<string, string[]> = {
    "CRA / Background Screening": [
      "background screen", "cra", "consumer reporting", "employment screen",
      "tenant screen", "fcra", "compliance", "verification", "criminal record",
      "drug test", "pre-employment", "background check",
    ],
    "Enterprise SaaS": [
      "saas", "platform", "workflow automation", "enterprise", "b2b",
      "cloud", "software", "dashboard", "integration", "api",
    ],
    "Professional Services": [
      "consulting", "advisory", "services", "solutions", "partner",
      "expertise", "insights", "strategy", "transformation",
    ],
    "Legal / Compliance": [
      "legal", "regulatory", "compliance", "risk", "governance",
      "audit", "policy", "regulation",
    ],
    "HR / Recruiting": [
      "recruit", "talent", "hiring", "hr", "human resources",
      "workforce", "staffing", "onboarding", "applicant",
    ],
  };

  let bestIndustry = "General Business";
  let bestScore = 0;

  for (const [industry, keywords] of Object.entries(patterns)) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndustry = industry;
    }
  }

  return bestIndustry;
}

function inferAudience(text: string, industry: string): string[] {
  const audiences: string[] = [];
  const checks: [string, string][] = [
    ["cra", "Background Screening Companies"],
    ["screening", "Background Screening Companies"],
    ["cra", "Consumer Reporting Agencies"],
    ["employer", "Employers & HR Teams"],
    ["hr", "HR Professionals"],
    ["recruiter", "Recruiters"],
    ["tenant", "Property Managers"],
    ["compliance", "Compliance Officers"],
    ["it", "IT Departments"],
    ["ceo", "C-Suite Executives"],
    ["operations", "Operations Managers"],
    ["small business", "Small Business Owners"],
  ];
  for (const [keyword, audience] of checks) {
    if (text.includes(keyword) && !audiences.includes(audience)) {
      audiences.push(audience);
    }
  }
  return audiences.length > 0 ? audiences : ["General Business Audience"];
}

function inferTone(text: string): string {
  const markers = {
    professional: ["solution", "enterprise", "platform", "integrate", "compliance", "security"],
    modern: ["innovate", "transform", "next-gen", "modern", "digital"],
    friendly: ["we help", "partner with", "team", "together", "let us"],
    direct: ["get started", "book a demo", "try now", "sign up", "pricing"],
    technical: ["api", "integration", "workflow", "automation", "sdk", "rest"],
  };

  const scores: Record<string, number> = {};
  for (const [tone, words] of Object.entries(markers)) {
    scores[tone] = words.filter(w => text.includes(w)).length;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sorted.length > 0 && sorted[0][1] > 0 ? sorted[0][0] : "neutral";
}

function inferSections(headings: string[]): string[] {
  const sectionKeywords = [
    "about", "services", "product", "solution", "feature",
    "pricing", "contact", "blog", "resources", "team",
    "testimonial", "case study", "faq", "support", "demo",
    "why us", "mission", "vision", "values", "careers",
  ];
  const found: string[] = [];
  const text = headings.join(" ").toLowerCase();
  for (const section of sectionKeywords) {
    if (text.includes(section)) found.push(section.charAt(0).toUpperCase() + section.slice(1));
  }
  return found;
}

function inferLayout(headings: string[]): string {
  // Basic heuristic: if lots of headings, likely text-heavy
  if (headings.length > 10) return "text-heavy / long-form";
  if (headings.length > 5) return "multi-section";
  return "minimal / single-scroll";
}

function inferStrengths(title: string, desc: string, industry: string): string[] {
  const s: string[] = [];
  // Check if they have a clear value prop in title
  if (title.includes(" - ") || title.includes(" | ")) {
    s.push("Clear brand name + tagline structure");
  }
  if (desc.length > 80) {
    s.push("Descriptive meta (good for SEO)");
  }
  if (industry !== "General Business") {
    s.push(`Focused on ${industry.split("/")[0].trim()} industry`);
  }
  return s.length > 0 ? s : ["Standard business presence"];
}

function inferWeaknesses(text: string, strengths: string[]): string[] {
  const w: string[] = [];
  if (text.length < 200) w.push("Very thin content — may lack substance");
  if (text.split(".").length < 10) w.push("Limited copy — consider expanding messaging");
  if (!text.includes("demo") && !text.includes("contact")) {
    w.push("No clear call-to-action found");
  }
  if (!text.includes("about")) w.push("No about/mission section detected");
  if (!strengths.some(s => s.includes("Clear brand"))) {
    w.push("Brand messaging may be unclear");
  }
  return w.length > 0 ? w : ["No obvious weaknesses in extracted text"];
}

// ── Design System Generator ──

export interface DesignSystem {
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    muted: string;
    success: string;
    warning: string;
    error: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    monoFont: string;
    scale: number[];
  };
  spacing: {
    unit: number;
    scale: number[];
  };
  borderRadius: string;
  shadows: string[];
}

export function generateDesignSystem(
  industry: string,
  tone: string,
  preferences?: Partial<DesignSystem>
): DesignSystem {
  // Industry-aware color palettes
  const palettes: Record<string, { primary: string; secondary: string; accent: string }> = {
    "CRA / Background Screening": {
      primary: "#1a365d",    // Deep navy — trust, security
      secondary: "#2b6cb0",  // Blue — reliability
      accent: "#38a169",     // Green — verification, "all clear"
    },
    "Enterprise SaaS": {
      primary: "#1a202c",
      secondary: "#4a5568",
      accent: "#4299e1",
    },
    "Professional Services": {
      primary: "#2d3748",
      secondary: "#718096",
      accent: "#d69e2e",
    },
    "Legal / Compliance": {
      primary: "#1a202c",
      secondary: "#2d3748",
      accent: "#c53030",
    },
    "HR / Recruiting": {
      primary: "#553c9a",
      secondary: "#805ad5",
      accent: "#38a169",
    },
  };

  const basePalette = palettes[industry] || palettes["Enterprise SaaS"];

  return {
    palette: {
      primary: preferences?.palette?.primary || basePalette.primary,
      secondary: preferences?.palette?.secondary || basePalette.secondary,
      accent: preferences?.palette?.accent || basePalette.accent,
      background: "#ffffff",
      surface: "#f7fafc",
      text: "#1a202c",
      muted: "#718096",
      success: "#38a169",
      warning: "#d69e2e",
      error: "#e53e3e",
    },
    typography: {
      headingFont: preferences?.typography?.headingFont || "Inter, system-ui, sans-serif",
      bodyFont: preferences?.typography?.bodyFont || "Inter, system-ui, sans-serif",
      monoFont: preferences?.typography?.monoFont || "JetBrains Mono, monospace",
      scale: [12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72],
    },
    spacing: {
      unit: 4,
      scale: [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128],
    },
    borderRadius: "8px",
    shadows: [
      "0 1px 2px rgba(0,0,0,0.05)",
      "0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)",
      "0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06)",
      "0 10px 15px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05)",
      "0 20px 25px rgba(0,0,0,0.1), 0 10px 10px rgba(0,0,0,0.04)",
    ],
  };
}
