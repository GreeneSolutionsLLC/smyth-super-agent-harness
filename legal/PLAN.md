# Legal & Compliance Plan — Smyth.app

Owner: Rook / GLM 5.2  
Reviewer: Rob (Greene Solutions LLC), Main / Kimi K2.7 (in-app integration)  
Scope: v2 full app, downloadable macOS `.dmg`

---

## 1. Entity & Product

- **Company:** Greene Solutions LLC
- **Product:** Smyth Super Agent ("Smyth")
- **Distribution:** Direct-download macOS application (`.dmg`)
- **Jurisdiction default:** United States, with GDPR/CCPA-friendly language included for international users.

---

## 2. Required Legal Documents

Produce four plain-English legal documents as static HTML pages in `legal/`.

| Document | File | Purpose |
|----------|------|---------|
| End User License Agreement (EULA) | `legal/eula.html` | Governs use of the software. |
| Privacy Policy | `legal/privacy.html` | Explains what data is collected, stored, shared. |
| Terms of Service / Terms of Use | `legal/terms.html` | Rules, liability, dispute resolution. |
| Accessibility Statement | `legal/accessibility.html` | Commitment, known limitations, feedback channel. |

All four are bundled as static HTML in the app and viewable offline.

---

## 3. Common Content Blocks

Each document must include:

- **Effective date:** 2026-08-04
- **Company name and contact:**
  - Greene Solutions LLC
  - Support/contact email: `sales@greene-solutions.com`
- **Last updated date**
- Plain-English summaries at the top of each document
- Link to the other three documents in the footer

---

## 4. EULA Content Outline

1. **Grant of License**
   - Smyth is licensed, not sold.
   - Single-user license per download.
   - No redistribution, reverse engineering, or SaaS-ification without written permission.

2. **User Obligations**
   - User supplies their own API keys.
   - User is responsible for outputs, especially AI-generated content.
   - User must comply with third-party terms (OpenAI, Anthropic, Ollama, etc.).

3. **Data & Privacy**
   - Chat history and files stored locally on the user's machine unless user configures third-party sync.
   - API calls are sent directly from the user's machine to the selected provider.
   - Greene Solutions does not collect chat content.

4. **Third-Party Services**
   - OmniRoute, Ollama, OpenClaw, Parallel, AgenticMail, Zernio, etc. are third parties.
   - Their terms and privacy policies apply.

5. **Disclaimer**
   - AI outputs may be inaccurate; verify before use.
   - No warranty of fitness for any purpose.
   - Limitation of liability to amount paid for the app (zero for free downloads).

6. **Termination**
   - License terminates if user breaches terms.
   - User may uninstall at any time.

7. **Governing Law**
   - Delaware / United States (placeholder; Rob to confirm).

---

## 5. Privacy Policy Content Outline

1. **Data We Collect**
   - No account required.
   - No server-side chat storage by Greene Solutions.
   - Optional crash logs and anonymous usage telemetry (if added later) can be disabled in Settings.

2. **Data Stored Locally**
   - `~/Library/Application Support/smyth/.env`
   - Chat history, uploaded files, workspace files.
   - User is responsible for backups and deletion.

3. **Data Sent to Third Parties**
   - Prompts, files, and API keys are sent directly to the AI providers chosen by the user.
   - Provider-specific privacy policies govern that data.

4. **Cookies / Tracking**
   - Smyth does not use cookies or trackers.
   - Third-party services may have their own tracking.

5. **User Rights (GDPR/CCPA)**
   - Users can access, export, or delete local data from the Settings panel.
   - No account deletion needed.

6. **Children**
   - Not intended for users under 13 / 16 depending on region.

7. **Contact**
   - Support email: sales@greene-solutions.com.
   - Mailing address: (optional — add if needed)

---

## 6. Terms of Service Content Outline

1. **Acceptance**
   - By installing or using Smyth, user agrees.

2. **Description of Service**
   - Local AI workspace that routes user requests to user-selected providers.

3. **User Accounts**
   - No account required.
   - User keys are stored locally.

4. **Acceptable Use**
   - No illegal, harmful, or abusive use.
   - No automated scraping of Smyth itself.
   - Respect third-party provider terms.

5. **Intellectual Property**
   - Greene Solutions owns Smyth code and brand.
   - User owns their inputs and outputs, subject to third-party provider terms.
   - AI-generated outputs may not be copyrightable in all jurisdictions.

6. **Disclaimers**
   - AI outputs are not legal, medical, financial, or professional advice.
   - Verify before acting on outputs.

7. **Limitation of Liability**
   - Maximum liability capped at amount paid.
   - Exclusion of indirect damages.

8. **Indemnification**
   - User agrees to defend Greene Solutions against claims arising from misuse.

9. **Changes to Terms**
   - Updates posted in-app and online.
   - Continued use = acceptance.

10. **Contact / Disputes**
    - Contact email: sales@greene-solutions.com.
    - Governing law: **Delaware, United States**.
    - Dispute resolution: binding arbitration in Delaware, unless prohibited by applicable law. Class-action waiver included.

---

## 7. Accessibility Statement Content Outline

1. **Commitment**
   - Greene Solutions aims to make Smyth usable for people with disabilities.

2. **Current Standards**
   - Target: WCAG 2.1 Level AA where feasible.
   - Built with web technologies (keyboard navigation, screen reader support).

3. **Known Limitations**
   - Some advanced visualizations and video tools may rely on mouse/touch.
   - Third-party AI provider responses may not always be formatted accessibly.

4. **Feedback**
   - Contact email for accessibility issues: sales@greene-solutions.com.

5. **Compatibility**
   - macOS VoiceOver, keyboard shortcuts, dynamic type.

---

## 8. Open Source Acknowledgments

Create `legal/acknowledgments.html` listing dependencies and licenses.

Process:
1. Run `npm ls --depth=0` and extract production dependencies.
2. Generate from `package.json` license metadata using a tool like `license-checker` or `npx license-report`.
3. Group by license type: MIT, Apache-2.0, BSD, ISC, etc.
4. Include required attribution notices (e.g., Next.js, Electron, React, Tailwind, shadcn/ui).
5. Link from About box and legal footer.

---

## 9. In-App Legal Integration

- Setup wizard final step requires checkbox: "I agree to the Terms of Service and Privacy Policy."
- Settings → Legal menu opens a modal/browser window with links to all documents.
- About Smyth dialog links to EULA, Privacy, Terms, Accessibility, Acknowledgments.
- Legal HTML pages are bundled in `resources/legal/` and loaded via `file://` or served by the local Smyth server.

---

## 10. Files to Create

```
legal/
├── PLAN.md                # this file
├── eula.html              # End User License Agreement
├── privacy.html           # Privacy Policy
├── terms.html             # Terms of Service
├── accessibility.html     # Accessibility Statement
└── acknowledgments.html   # Third-party open source licenses
```

---

## 11. Rob Input Needed

- Real support/contact email → `sales@greene-solutions.com` ✅
- Company mailing address (optional, for formal notices) → **pending**
- Governing law / jurisdiction preference → **Delaware, United States** ✅
- Whether to include arbitration clause → **Yes** ✅
- Whether to include subscription/payment terms → **Not applicable for v2 free download** ✅
