const contactEmail = "singhshashwat.dev@gmail.com";
function Contact() {
  return <p>Alfred is developed and operated by Shashwat Singh, based in India. For support, privacy requests or grievances, email <a href={`mailto:${contactEmail}`}>{contactEmail}</a>. Please describe your request and the account concerned; do not send passwords or sign-in tokens.</p>;
}

function PrivacyPolicy() {
  return <>
    <p>This policy explains how Alfred collects, uses, stores and shares information when you use its task, note, schedule, reminder and AI assistant features. “We”, “us” and “our” refer to Shashwat Singh, the operator of Alfred.</p>
    <h2>1. Information we store and why</h2>
    <ul>
      <li><strong>Account information.</strong> For Google sign-in, new accounts store your Google account identifier to identify your Alfred account. Your Google name and photo are passed to your device through a short-lived sign-in handoff; these fields are removed from the handoff when it is consumed. Custom account names and photos stay on your device unless Cloud Sync is enabled, in which case they are stored with your cloud workspace and count toward cloud storage usage. Older accounts may still contain previously saved name, verified email and profile picture fields until removed. Guest accounts have an account identifier and guest identifier instead. Account creation, update and security records help maintain access and prevent unauthorized use.</li>
      <li><strong>Your content.</strong> Tasks, completion status and priorities; note titles and contents; and schedule topics, dates and times are stored on your device by default. They are uploaded to Alfred’s server only when you enable Cloud Sync. This choice also applies to content created through the assistant. Existing cloud content is retained until you explicitly move it to your device or delete it.</li>
      <li><strong>Preferences and reminders.</strong> We store onboarding completion and your Cloud Sync choice. With Cloud Sync enabled, we also store notification preferences, reminder timing, selected time zone and delivery destinations. Notification registrations include the device platform, account association and protected device/session identifiers. Delivery records identify the relevant event, device and delivery time to prevent duplicate reminders.</li>
      <li><strong>Usage and security records.</strong> We record account storage usage, daily and monthly AI request counts, request identifiers, request status, timestamps and a cryptographic fingerprint of each AI request. These support usage limits, troubleshooting and prevention of duplicate actions. The usage ledger does not contain the text of your messages or raw audio recordings.</li>
      <li><strong>Connection and diagnostic information.</strong> Our servers and infrastructure process connection information, such as IP addresses, request timing, response status and error details, to deliver the service and protect against abuse. Diagnostic records may contain information relevant to a failure. They are separate from your saved tasks, notes and schedules.</li>
      <li><strong>Support messages.</strong> If you contact us, we receive your email address, message and any attachments you choose to send. We use this correspondence to answer questions, handle privacy requests and resolve issues. Do not include sensitive information that is unnecessary for your request.</li>
    </ul>

    <h2>2. Chat, voice and AI processing</h2>
    <p>When you use AI, Alfred sends your submitted message or recording, relevant recent conversation context, and workspace content needed for assistant tools through our backend to Google Gemini. Tool results may include task, note or schedule information needed to carry out your request. Follow-up requests can include earlier messages and recordings from the active conversation.</p>
    <p>Alfred does not maintain a permanent account history of chat messages or raw voice recordings. The app holds these in memory for the active conversation, and the backend processes them to provide a response. In local mode, the current workspace is processed transiently by the backend for assistant actions and returned to your device without saving its content to Atlas. If you turn a conversation into a saved note, task or event, it follows your local or Cloud Sync storage choice. AI request metadata and provider records have separate retention, described below.</p>
    <p>Google’s handling of AI inputs and outputs depends on its API service terms and billing configuration. Unpaid API use can involve product improvement, model training and human review. Paid API terms state that inputs and outputs are not used to improve Google’s products, but allow limited retention for abuse prevention and legal requirements. See the <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Gemini API terms</a> and <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a>. We do not promise zero retention or no training by an independent provider. Avoid sending sensitive or confidential information through AI features.</p>
    <p>We do not use your content to train our own AI models. You can use tasks, notes and schedules without sending their content to an AI conversation.</p>

    <h2>3. What Alfred does not collect or access</h2>
    <p>Alfred does not receive your Google password. Its Google sign-in permissions cover basic identity, email and profile information; they do not authorize access to your Gmail messages, Google Drive files, contacts or Google Calendar. Google access and refresh tokens are not saved as part of your Alfred account.</p>
    <p>The app does not collect payment-card details, precise GPS location, browsing history, camera images or unrelated files from your device as part of its current features. It does not include an advertising SDK, sell your account content or use your saved content for advertising. Information you voluntarily include in a note, message or recording is still processed as described in this policy.</p>
    <p>Microphone access is used for voice features you activate. Hands-free mode can automatically submit detected speech while that mode is active; stop voice mode to end that session. Alfred does not use the microphone to listen outside a voice feature you have started.</p>

    <h2>4. Information kept on your device</h2>
    <p>The app keeps your account-scoped tasks, notes and schedules, Alfred session credential, basic account information, voice and overlay preferences, sidebar preferences and notification installation information on your device. Clearing device storage or uninstalling can remove locally saved content. Short-lived sign-in data and an authentication cookie help complete Google sign-in securely. Android reminder and assistant features may also keep session credentials and reminder state in app-private storage so native features can work.</p>
    <p>If you choose a new guest after a session recovery problem, the app may retain the previous session credential locally for recovery. Signing out, clearing app storage and deleting an account are different actions: clearing local storage can remove local content and access information but does not delete cloud content.</p>
    <p>Guest use creates an online account identity and usage records, but guest workspace content stays on the device by default. Cloud Sync is optional; AI still needs an internet connection. Losing the device or its guest credential can prevent you from accessing that account. Signing in with Google can link or transfer the current guest workspace to your Google-linked Alfred account.</p>

    <h2>5. Who receives information</h2>
    <p>Service infrastructure and database providers process the information needed to host Alfred. Google processes Google sign-in and Gemini AI requests. Your operating system processes microphone permissions, native assistant features and notifications. Reminder text may be visible on a lock screen or to someone with access to your device.</p>
    <p>Loading Google-hosted fonts or profile images makes a request to those hosts, which can receive connection information such as your IP address. Independent providers process information under their own applicable terms and privacy notices. We may disclose information when required by law, to respond to a valid legal request, or as reasonably necessary to protect users and the security of the service.</p>
    <p>Service providers may process information in India or other countries. This policy does not promise that all information stays in India or on your device.</p>

    <h2>6. Retention and account deletion</h2>
    <p>Cloud content remains until you delete it, move it to your device while turning Cloud Sync off, or delete the account. Local content remains on its device until removed there. AI request records normally expire about 40 days after a request; daily and monthly usage counters expire about 40 days after the relevant usage window ends. Notification device registrations expire after about 30 days unless renewed, and delivery records expire about 90 days after the event. Pending Google sign-in attempts are valid for up to 10 minutes and handoff tickets for about 90 seconds. Expired database records are removed by background cleanup, which is not instantaneous.</p>
    <p>You can delete your Alfred account in Settings. This removes live account records, tasks, notes, schedules, preferences, onboarding state, AI usage/request records, notification registrations and pending sign-in records associated with that account, and invalidates its Alfred sessions. Google-linked accounts may require a recent sign-in before deletion. Starting a different guest account does not delete an older guest account.</p>
    <p>Account deletion does not delete your Google account, revoke every Google authorization grant, erase data already processed by an independent AI provider, or guarantee immediate removal from infrastructure logs or any backups. Such records are subject to their own retention and applicable legal requirements. You can manage Google authorizations in your Google account settings. Device preferences or credentials for other accounts may remain until you clear app storage.</p>
    <p>Support correspondence and diagnostic records are retained only for as long as reasonably needed to address the relevant issue, protect the service or meet applicable legal requirements.</p>

    <h2>7. Security, choices and privacy requests</h2>
    <p>Alfred uses account-scoped access controls and authenticated sessions to restrict access to account data. No storage or transmission system is completely secure. Content sent to the backend or an AI provider is processed by those services; Alfred does not provide end-to-end encryption that prevents the service from processing your content.</p>
    <p>You can edit or delete saved content, delete your account, avoid AI or voice features, and change microphone and notification permissions in device settings. To request information about personal data, correction, erasure, withdrawal of consent, a copy of your data, or grievance handling, contact us using the details below. We may need reasonable information to verify account ownership. Available rights and any permitted exceptions depend on applicable law, and we handle requests within the applicable legal time limits. Some requests may affect our ability to provide the service. Where applicable law allows, you may also raise a complaint with the competent authority.</p>

    <h2>8. Adults, policy updates and contact</h2>
    <p>Alfred is intended for adults aged 18 and over. We do not knowingly provide accounts to children. If you believe a child has supplied personal information, contact us so we can investigate and take appropriate action.</p>
    <p>We may update this policy as the service changes. The effective date identifies the current version. We will provide notice of material changes through the app or another appropriate service channel, and request further consent where required by applicable law.</p>
    <Contact />
  </>;
}

function TermsOfService() {
  return <>
    <p>These Terms govern your use of Alfred, operated by Shashwat Singh in India. By using Alfred, you agree to these Terms. If you do not agree, do not use the service. The Privacy Policy explains our handling of personal information.</p>
    <h2>1. Eligibility and access</h2>
    <p>You must be at least 18 years old and legally able to enter into these Terms. You may use Alfred with Google sign-in or as a guest. Google sign-in is optional, and Alfred does not provide a separate email-and-password account. You are responsible for securing your device, Google account and Alfred session, and for activity you authorize through them.</p>
    <p>Guest content is stored on your device by default and uploaded only with Cloud Sync enabled. Access depends on the guest session saved on your device. We cannot promise recovery of a guest account if you lose that credential. Google sign-in may transfer or merge the current guest workspace into a Google-linked Alfred account.</p>

    <h2>2. Your content and permission to process it</h2>
    <p>You retain your rights in the tasks, notes, schedules and other content you provide. You give us permission to host, copy, transmit and process that content as needed to provide the features you use, maintain security and meet legal obligations. Using AI authorizes us to send relevant information to the AI provider as described in the Privacy Policy and the provider terms linked there.</p>
    <p>Only submit content you have the right to use and share. Do not use Alfred to violate another person’s privacy or intellectual property rights. You are responsible for keeping your own copies of information you cannot afford to lose.</p>

    <h2>3. AI responses and assistant actions</h2>
    <p>AI responses can be inaccurate, incomplete or misleading. Review important information and changes to your workspace. Your requests can authorize the assistant to create or update tasks, notes and events, and to clear schedule events. Actions can affect stored data as soon as a tool executes; not every assistant action has a separate confirmation screen. Schedule clearing can permanently remove events for a day or across all dates.</p>
    <p>Do not rely on Alfred for emergency decisions or as a substitute for qualified medical, legal, financial or other professional advice. AI responses may not be unique, and you are responsible for deciding whether a response or action is appropriate for your circumstances.</p>

    <h2>4. Voice, reminders and third-party services</h2>
    <p>Voice features require microphone access. Hands-free mode can automatically send detected speech while enabled. You are responsible for activating and stopping voice features and for obtaining any permission needed to record other people.</p>
    <p>Reminders depend on device permissions, app and operating system behavior, time-zone settings, connectivity and service availability. They may be delayed or fail. Alfred is not an emergency, medical-alert or guaranteed alarm service. Scheduling an event in Alfred does not, by itself, create an event in Google Calendar or another external calendar.</p>
    <p>Google sign-in, AI processing and other third-party features are subject to their providers’ terms and availability. Using Google sign-in does not give Alfred access to your Gmail, Drive or Google Calendar content.</p>

    <h2>5. Acceptable use</h2>
    <p>Use Alfred lawfully. Do not attempt to access another user’s account, bypass authentication or usage restrictions, interfere with the service, introduce malicious software, exploit security weaknesses, or use the service for fraud, harassment or other unlawful conduct. Do not attempt to extract service credentials or abuse the AI provider’s safeguards.</p>
    <p>You receive permission to use Alfred for its intended functions while you comply with these Terms. This does not transfer ownership of Alfred’s software, branding or other service materials to you, or limit rights you have under applicable law or any open-source licenses that apply to components.</p>

    <h2>6. Usage allowances and availability</h2>
    <p>Cloud storage and AI allowances are shown in Settings and are applied by the service. The standard allowance is 10 MB of synced account content, including cloud profiles, 50 AI requests per day and 1,000 per month. Local content is subject to device storage availability instead of the cloud quota. Chat and voice share the AI allowances, which reset at UTC day and month boundaries. A request accepted for AI processing can count even if the provider later fails or the connection closes. Other reasonable request-size, rate and safety restrictions may apply.</p>
    <p>We may change or maintain features and allowances, address security issues, or suspend availability. Material changes that affect your use will be communicated through the app or another appropriate service channel. We do not guarantee uninterrupted service, perpetual availability of a feature or recovery of deleted content.</p>

    <h2>7. Ending use and account deletion</h2>
    <p>You may stop using Alfred at any time and delete your account in Settings. Signing out or uninstalling the app does not by itself delete server content. Account deletion and bulk clearing are permanent actions; retain any information you need first. Deleting an Alfred account does not delete your Google account or independent third-party records.</p>
    <p>We may restrict or suspend access when reasonably necessary to address misuse, a security risk, a legal requirement or a material breach of these Terms. Where practicable and permitted, we will explain the reason and provide an opportunity to resolve the issue. Contact us if you believe access was restricted in error.</p>

    <h2>8. Service assurances and responsibility</h2>
    <p>We aim to provide a useful and reliable service. Except for rights and assurances required by applicable law, Alfred is provided on an “as available” basis, without a guarantee that it will be error-free, meet every requirement or preserve every item of data.</p>
    <p>To the extent permitted by applicable law, we are not responsible for indirect or consequential loss, lost business profits, or loss arising from reliance on inaccurate AI output or unavailable reminders. Nothing in these Terms excludes liability for fraud, deliberate misconduct, or any liability or consumer right that cannot lawfully be excluded. Your responsibilities under these Terms do not remove our obligations under applicable law.</p>

    <h2>9. Changes, applicable law and contact</h2>
    <p>These Terms are governed by the laws of India, subject to any mandatory protections that apply to you under applicable law. Please contact us first to try to resolve a dispute. Nothing here prevents you from using an available consumer, regulatory or court remedy.</p>
    <p>We may update these Terms and will give appropriate notice of material changes. The revised effective date will be shown here. If you do not agree to a change, stop using Alfred and, if you wish, delete your account. If a provision cannot be enforced, the remaining provisions continue to apply to the extent permitted by law.</p>
    <Contact />
  </>;
}

export function Legal({ page }: { page: "privacy" | "terms" }) {
  return <article className="alfred-legal"><h1>{page === "privacy" ? "Privacy Policy" : "Terms of Service"}</h1><p>Effective <time dateTime="2026-10-19">19 October 2026</time></p>{page === "privacy" ? <PrivacyPolicy /> : <TermsOfService />}</article>;
}
