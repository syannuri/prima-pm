import { Link, useParams } from 'react-router-dom';
import BrandMark from '../components/BrandMark';

// Public legal documents (Terms, Privacy, Cookie Policy, DPA). These resolve regardless of auth state
// (see App.tsx — a /legal/* path short-circuits before the signed-in / signed-out branches) so they can
// be linked from the marketing footer, the login page, emails, and the cookie banner alike.
//
// The copy is deliberately plain, English-global (matching the transactional emails), and reflects what
// the product ACTUALLY does today — essential-only cookies, self-service GDPR export/erase, the named AI
// subprocessors. Treat it as a solid, accurate baseline; a production launch should still have counsel
// review it against the operating entity's jurisdiction.

const EFFECTIVE = 'Effective date: 6 September 2026';
const CONTACT = 'support@prismatix.tech';

interface Section {
  heading: string;
  body: (string | string[])[]; // string = paragraph; string[] = bullet list
}

interface Doc {
  slug: string;
  title: string;
  intro: string;
  sections: Section[];
}

const TERMS: Doc = {
  slug: 'terms',
  title: 'Terms of Service',
  intro:
    'These Terms of Service ("Terms") govern your access to and use of the PRISMATIX project-management platform and related services ("Service"). By creating an account or using the Service you agree to these Terms.',
  sections: [
    {
      heading: '1. Accounts',
      body: [
        'You must provide accurate information when you register and keep it up to date. You are responsible for safeguarding your credentials and for all activity under your account.',
        'A workspace administrator manages members, roles, and data within their workspace (tenant). If you are invited to a workspace, your use is also subject to that workspace administrator\'s decisions about access and configuration.',
      ],
    },
    {
      heading: '2. Acceptable use',
      body: [
        'You agree not to misuse the Service. In particular, you will not:',
        [
          'attempt to access data belonging to other workspaces or users;',
          'probe, scan, or test the vulnerability of the Service without authorization;',
          'upload unlawful, infringing, or malicious content;',
          'use the Service to build a competing product by scraping or bulk-extracting non-your data;',
          'interfere with or disrupt the integrity or performance of the Service.',
        ],
      ],
    },
    {
      heading: '3. Your content',
      body: [
        'You retain all rights to the data you submit to the Service ("Customer Data"). You grant us a limited licence to host, process, and display Customer Data solely to provide and support the Service.',
        'You are responsible for the lawfulness of Customer Data and for having the rights necessary to submit it.',
      ],
    },
    {
      heading: '4. AI features',
      body: [
        'Some features use third-party AI models to generate drafts, summaries, and suggestions. AI output can be inaccurate or incomplete and is provided for your review — you remain responsible for decisions you make. AI features are off by default and are enabled per workspace by an administrator.',
      ],
    },
    {
      heading: '5. Plans, trials, and billing',
      body: [
        'Paid plans, trials, and their limits are described at sign-up or in your workspace settings. Fees are billed through our payment processor. Except where required by law, fees are non-refundable.',
      ],
    },
    {
      heading: '6. Availability and changes',
      body: [
        'We work to keep the Service available but do not guarantee uninterrupted operation. We may modify or discontinue features, and we may update these Terms; material changes will be notified through the Service or by email.',
      ],
    },
    {
      heading: '7. Termination',
      body: [
        'You may stop using the Service at any time. We may suspend or terminate access for breach of these Terms or to comply with law. On termination you may export your data as described in the Privacy Policy before it is deleted in accordance with our retention practices.',
      ],
    },
    {
      heading: '8. Disclaimers and liability',
      body: [
        'The Service is provided "as is" without warranties of any kind to the extent permitted by law. To the maximum extent permitted by law, our aggregate liability arising out of or relating to the Service is limited to the amounts you paid for the Service in the twelve months before the event giving rise to the claim.',
      ],
    },
    {
      heading: '9. Contact',
      body: [`Questions about these Terms: ${CONTACT}.`],
    },
  ],
};

const PRIVACY: Doc = {
  slug: 'privacy',
  title: 'Privacy Policy',
  intro:
    'This Privacy Policy explains what personal data PRISMATIX collects, how we use it, and the choices you have. It applies to the PRISMATIX platform and website.',
  sections: [
    {
      heading: '1. Data we collect',
      body: [
        'Account data: name, email, workspace, and role. Authentication data if you sign in with Google or Microsoft (we receive your basic profile from that provider).',
        'Customer Data: the project, schedule, cost, risk, and related information you enter into the Service.',
        'Usage and technical data: log data, device/browser information, and essential cookies needed to keep you signed in and secure the session.',
      ],
    },
    {
      heading: '2. How we use data',
      body: [
        'To provide, secure, and support the Service; to authenticate you; to send transactional messages (for example, approvals, resets, and notifications you opt into); and to comply with legal obligations.',
        'We do not sell your personal data, and we do not use Customer Data to train third-party AI models.',
      ],
    },
    {
      heading: '3. AI subprocessors',
      body: [
        'When a workspace enables AI features, the specific content needed for that feature (for example, a project summary you ask about) is sent to our AI providers to generate a response. Depending on the features enabled, these may include Anthropic (assistant, drafting), and — where the corresponding feature is turned on — OpenAI (speech-to-text), ElevenLabs (text-to-speech), and Voyage AI (semantic search embeddings).',
        'These providers process the data to return a result and do not use it to train their models on our behalf. AI features are off by default.',
      ],
    },
    {
      heading: '4. Other subprocessors',
      body: [
        'We use infrastructure and operational providers to run the Service, including hosting, transactional email, and payment processing (for paid plans). Each processes data only as needed to deliver its function.',
      ],
    },
    {
      heading: '5. Retention',
      body: [
        'We keep account and Customer Data for as long as your workspace is active and as needed to provide the Service, then delete or anonymise it in line with our retention practices and legal obligations.',
      ],
    },
    {
      heading: '6. Your rights',
      body: [
        'Subject to applicable law, you can access, correct, export, or delete your personal data. The Service provides self-service data export and workspace deletion; you can also contact us to exercise these rights.',
        `To make a request, email ${CONTACT}.`,
      ],
    },
    {
      heading: '7. Security',
      body: [
        'We protect data in transit with TLS, store sessions in httpOnly cookies with CSRF protection and refresh-token rotation, and isolate each workspace\'s data. No method of transmission or storage is completely secure, but we work to protect your information.',
      ],
    },
    {
      heading: '8. International transfers',
      body: [
        'Your data may be processed in countries other than your own. Where required, we rely on appropriate safeguards for such transfers.',
      ],
    },
    {
      heading: '9. Contact',
      body: [`Privacy questions or requests: ${CONTACT}.`],
    },
  ],
};

const COOKIES: Doc = {
  slug: 'cookies',
  title: 'Cookie Policy',
  intro:
    'This Cookie Policy explains how PRISMATIX uses cookies and similar technologies. We keep this minimal — we use only what is needed to run the Service.',
  sections: [
    {
      heading: '1. Essential cookies',
      body: [
        'We use strictly necessary cookies to keep you signed in, protect the session against cross-site request forgery, and remember essential preferences such as language. These cannot be switched off without breaking core functionality, so they do not require consent.',
      ],
    },
    {
      heading: '2. What we do not use',
      body: [
        'We do not use advertising cookies, and we do not sell data collected through cookies. Any analytics we run is limited to operating and improving the Service.',
      ],
    },
    {
      heading: '3. Local storage',
      body: [
        'We may use your browser\'s local storage to remember interface preferences (for example, that you have acknowledged the cookie notice). This information stays in your browser.',
      ],
    },
    {
      heading: '4. Managing cookies',
      body: [
        'You can clear or block cookies in your browser settings. Blocking essential cookies will prevent you from signing in.',
      ],
    },
    {
      heading: '5. Contact',
      body: [`Questions about cookies: ${CONTACT}.`],
    },
  ],
};

const DPA: Doc = {
  slug: 'dpa',
  title: 'Data Processing Addendum',
  intro:
    'This Data Processing Addendum ("DPA") supplements the Terms of Service and applies where PRISMATIX processes personal data on behalf of a customer ("Controller") in the course of providing the Service. Where you use PRISMATIX for your projects, you act as Controller and PRISMATIX acts as Processor.',
  sections: [
    {
      heading: '1. Roles and scope',
      body: [
        'The Controller determines the purposes and means of processing Customer Data. PRISMATIX, as Processor, processes Customer Data only on the Controller\'s documented instructions, which include these Terms and the configuration of the workspace.',
      ],
    },
    {
      heading: '2. Nature and purpose of processing',
      body: [
        'Processing is carried out to provide the project-management Service: hosting, storing, organising, and displaying Customer Data, and — where enabled by the Controller — generating AI assistance from it.',
        'Categories of data subjects and personal data are those the Controller chooses to include in Customer Data (for example, project team members\' names and email addresses).',
      ],
    },
    {
      heading: '3. Subprocessors',
      body: [
        'The Controller authorises PRISMATIX to engage subprocessors for hosting, email, payments, and (where the Controller enables AI features) the AI providers listed in the Privacy Policy. PRISMATIX imposes data-protection obligations on subprocessors consistent with this DPA and remains responsible for their performance.',
      ],
    },
    {
      heading: '4. Security',
      body: [
        'PRISMATIX maintains technical and organisational measures appropriate to the risk, including encryption in transit, per-workspace data isolation, session protection, and access controls, as further described in the Privacy Policy.',
      ],
    },
    {
      heading: '5. Data subject requests',
      body: [
        'Taking into account the nature of the processing, PRISMATIX assists the Controller in responding to data subject requests, including through the Service\'s self-service export and deletion capabilities.',
      ],
    },
    {
      heading: '6. Breach notification',
      body: [
        'PRISMATIX will notify the Controller without undue delay after becoming aware of a personal data breach affecting Customer Data.',
      ],
    },
    {
      heading: '7. Return and deletion',
      body: [
        'On termination, and at the Controller\'s choice, PRISMATIX will make Customer Data available for export and will delete or anonymise it in accordance with its retention practices, unless retention is required by law.',
      ],
    },
    {
      heading: '8. Contact',
      body: [`Data-protection enquiries: ${CONTACT}.`],
    },
  ],
};

const DOCS: Record<string, Doc> = {
  terms: TERMS,
  privacy: PRIVACY,
  cookies: COOKIES,
  dpa: DPA,
};

// Links shown across the top of every legal page so a reader can move between the documents.
const NAV: { slug: string; label: string }[] = [
  { slug: 'terms', label: 'Terms' },
  { slug: 'privacy', label: 'Privacy' },
  { slug: 'cookies', label: 'Cookies' },
  { slug: 'dpa', label: 'DPA' },
];

export default function LegalPage() {
  const { doc } = useParams<{ doc: string }>();
  const active = (doc && DOCS[doc]) || TERMS;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-200">
      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <BrandMark />
          <Link to="/" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">← Back to home</Link>
        </div>

        <nav className="mb-8 flex flex-wrap gap-2">
          {NAV.map((n) => (
            <Link
              key={n.slug}
              to={`/legal/${n.slug}`}
              className={
                'rounded-full px-3 py-1 text-sm font-medium transition ' +
                (n.slug === active.slug
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700')
              }
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <article className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-10">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{active.title}</h1>
          <p className="mt-1 text-xs text-slate-400">{EFFECTIVE}</p>
          <p className="mt-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{active.intro}</p>

          {active.sections.map((s) => (
            <section key={s.heading} className="mt-7">
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{s.heading}</h2>
              {s.body.map((b, i) =>
                Array.isArray(b) ? (
                  <ul key={i} className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    {b.map((li) => <li key={li}>{li}</li>)}
                  </ul>
                ) : (
                  <p key={i} className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{b}</p>
                ),
              )}
            </section>
          ))}
        </article>

        <p className="mt-8 text-center text-xs text-slate-400">© 2026 PRISMATIX. All rights reserved.</p>
      </div>
    </div>
  );
}
