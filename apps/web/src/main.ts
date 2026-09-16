import type { BrowserSessionState, OpaqueSessionDescriptor } from '../../../packages/contracts/src/index.js';
import { requestLogout } from './session-client.js';
import {
  resolveAppPath,
  resolveLoginComposition,
  SHELL_DESTINATIONS,
} from './ui-model.js';
import type { ShellDestinationId } from './ui-model.js';

const queriedRoot = document.querySelector<HTMLElement>('#app');
if (!queriedRoot) throw new Error('HULK SA Web Player root element is missing.');
const root: HTMLElement = queriedRoot;
const appBasePath = document.querySelector<HTMLMetaElement>('meta[name="hulk-app-base-path"]')?.content ?? '';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const LOGIN_COPY = Object.freeze({
  title: 'اهلا بك',
  description: 'ادخل بيانات اشتراكك للمتابعه',
  rememberAccount: 'تذكر الحساب',
  showPassword: 'اظهار كلمه المرور',
  submit: 'دخول الى HULK',
  submitting: 'جاري الدخول...',
  checking: 'جاري التحقق من بيانات الاشتراك...',
  tooManyAttempts: 'تم تجاوز عدد المحاولات المسموح. حاول لاحقا.',
  authenticationFailed: 'تعذر تسجيل الدخول. تحقق من بيانات المزود وحالة الاشتراك.',
  serviceUnavailable: 'تعذر الاتصال بخدمة تسجيل الدخول.',
});

type IconName =
  | 'portal'
  | 'user'
  | 'lock'
  | 'home'
  | 'live'
  | 'movies'
  | 'series'
  | 'logout';

const ICON_PATHS: Readonly<Record<IconName, readonly string[]>> = Object.freeze({
  portal: Object.freeze([
    'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
    'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  ]),
  user: Object.freeze([
    'M12 12a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5Z',
    'M4 21a8 8 0 0 1 16 0',
  ]),
  lock: Object.freeze([
    'M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10',
    'M6 10h12v10.5H6Z',
    'M12 14v3',
  ]),
  home: Object.freeze([
    'M3 11.5 12 4l9 7.5',
    'M5.5 10.5V20h13v-9.5',
    'M9.5 20v-5h5v5',
  ]),
  live: Object.freeze([
    'M4 7.5h16v11H4Z',
    'M9.5 3.5 12 6l2.5-2.5',
    'M10.5 11 15 13l-4.5 2Z',
  ]),
  movies: Object.freeze([
    'M4 7h16v13H4Z',
    'M4 7l2-3h14l-2 3',
    'M8 4 6 7M13 4l-2 3M18 4l-2 3',
  ]),
  series: Object.freeze([
    'M5 6h14v14H5Z',
    'M9 3h6',
    'M9 10h6M9 14h6M9 18h4',
  ]),
  logout: Object.freeze([
    'M10 5H6.5A2.5 2.5 0 0 0 4 7.5v9A2.5 2.5 0 0 0 6.5 19H10',
    'M14 8l4 4-4 4',
    'M18 12H9',
  ]),
});

const DESTINATION_ICONS: Readonly<Record<ShellDestinationId, IconName>> = Object.freeze({
  home: 'home',
  live: 'live',
  movies: 'movies',
  series: 'series',
});

type ViewState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'signed-out'; error: string | null }>
  | Readonly<{
      kind: 'signed-in';
      session: OpaqueSessionDescriptor;
      busy: boolean;
      error: string | null;
    }>;

type LoginOption = Readonly<{
  control: HTMLLabelElement;
  input: HTMLInputElement;
}>;

let viewState: ViewState = Object.freeze({ kind: 'loading' });
let activeDestination: ShellDestinationId = 'home';
let activeLoginStage: HTMLElement | null = null;

function appPath(path: string): string {
  return resolveAppPath(appBasePath, path);
}

function createIcon(name: IconName): SVGSVGElement {
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg');
  icon.classList.add('ui-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.8');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');

  for (const pathData of ICON_PATHS[name]) {
    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('d', pathData);
    icon.append(path);
  }
  return icon;
}

function createCheckmarkIcon(): SVGSVGElement {
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg');
  icon.classList.add('login-option-check');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', 'M3.5 8.25 6.55 11.3 12.5 4.75');
  icon.append(path);
  return icon;
}

function createBrandImage(variant: 'badge' | 'lockup', className: string): HTMLImageElement {
  const image = document.createElement('img');
  image.className = className;
  image.src = appPath(`/assets/hulk-sa-${variant}.svg`);
  image.alt = 'HULK SA';
  image.decoding = 'async';
  return image;
}

function createButton(label: string, className: string, type: 'button' | 'submit' = 'button'): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = type;
  element.className = className;
  const text = document.createElement('span');
  text.textContent = label;
  element.append(text);
  return element;
}

function createLoginOption(id: string, label: string): LoginOption {
  const control = document.createElement('label');
  control.className = 'login-option-toggle';
  control.htmlFor = id;

  const input = document.createElement('input');
  input.id = id;
  input.type = 'checkbox';
  input.className = 'login-option-input';
  input.setAttribute('data-login-focus', 'true');
  input.setAttribute('data-login-option', 'true');

  const indicator = document.createElement('span');
  indicator.className = 'login-option-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  indicator.append(createCheckmarkIcon());

  const text = document.createElement('span');
  text.className = 'login-option-label';
  text.textContent = label;

  control.append(input, indicator, text);
  return Object.freeze({ control, input });
}

function syncLoginComposition(): void {
  if (!activeLoginStage) return;
  activeLoginStage.dataset.composition = resolveLoginComposition(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', syncLoginComposition, { passive: true });
window.visualViewport?.addEventListener('resize', syncLoginComposition, { passive: true });

function registerLoginStage(stage: HTMLElement): void {
  activeLoginStage = stage;
  syncLoginComposition();
}

function formatSessionExpiry(expiresAt: string): string {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return 'الجلسة فعالة';
  return new Intl.DateTimeFormat('ar-SA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function renderLoading(): void {
  const stage = document.createElement('main');
  stage.className = 'login-stage loading-stage';
  stage.setAttribute('aria-busy', 'true');
  registerLoginStage(stage);

  const brand = document.createElement('div');
  brand.className = 'login-brand';
  brand.append(createBrandImage('badge', 'brand-badge'));

  const panel = document.createElement('section');
  panel.className = 'login-panel loading-panel';
  const title = document.createElement('h1');
  title.textContent = 'HULK SA';
  const spinner = document.createElement('span');
  spinner.className = 'loading-ring';
  spinner.setAttribute('aria-hidden', 'true');
  const status = document.createElement('p');
  status.className = 'loading-copy';
  status.textContent = 'جارٍ التحقق من الجلسة…';
  panel.append(title, spinner, status);

  stage.append(brand, panel);
  root.replaceChildren(stage);
}

function createField(
  labelText: string,
  input: HTMLInputElement,
  iconName: IconName,
): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'field-control';

  const label = document.createElement('label');
  label.className = 'field-label';
  label.htmlFor = input.id;
  label.textContent = labelText;

  const frame = document.createElement('div');
  frame.className = 'input-frame';
  const icon = document.createElement('span');
  icon.className = 'field-icon';
  icon.append(createIcon(iconName));
  frame.append(icon, input);

  field.append(label, frame);
  return field;
}

function attachLoginDirectionalNavigation(form: HTMLFormElement): void {
  form.addEventListener('keydown', (event) => {
    const controls = Array.from(
      form.querySelectorAll<HTMLElement>('[data-login-focus="true"]'),
    ).filter((control) => !('disabled' in control) || !control.disabled);
    const current = document.activeElement as HTMLElement;
    const currentIndex = controls.indexOf(current);
    if (currentIndex < 0 || controls.length < 2) return;

    if (
      current.dataset.loginOption === 'true' &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      const options = controls.filter((control) => control.dataset.loginOption === 'true');
      const optionIndex = options.indexOf(current);
      if (optionIndex < 0 || options.length < 2) return;
      event.preventDefault();
      const delta = event.key === 'ArrowLeft' ? 1 : -1;
      const nextIndex = (optionIndex + delta + options.length) % options.length;
      options[nextIndex]?.focus({ preventScroll: true });
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (currentIndex + delta + controls.length) % controls.length;
    controls[nextIndex]?.focus({ preventScroll: true });
  });
}

function renderSignedOut(error: string | null): void {
  const stage = document.createElement('main');
  stage.className = 'login-stage';
  registerLoginStage(stage);

  const brand = document.createElement('div');
  brand.className = 'login-brand';
  brand.append(createBrandImage('badge', 'brand-badge'));

  const panel = document.createElement('section');
  panel.className = 'login-panel';
  panel.setAttribute('aria-labelledby', 'login-title');
  panel.setAttribute('aria-describedby', 'login-description');

  const heading = document.createElement('div');
  heading.className = 'login-heading';
  const title = document.createElement('h1');
  title.id = 'login-title';
  title.textContent = LOGIN_COPY.title;
  const description = document.createElement('p');
  description.id = 'login-description';
  description.textContent = LOGIN_COPY.description;
  heading.append(title, description);

  const form = document.createElement('form');
  form.className = 'login-form';
  form.noValidate = false;

  const host = document.createElement('input');
  host.id = 'provider-host';
  host.type = 'url';
  host.name = 'host';
  host.required = true;
  host.maxLength = 2048;
  host.autocomplete = 'off';
  host.inputMode = 'url';
  host.dir = 'ltr';
  host.placeholder = 'http://provider.example:8080';
  host.setAttribute('data-login-focus', 'true');

  const username = document.createElement('input');
  username.id = 'provider-username';
  username.type = 'text';
  username.name = 'username';
  username.required = true;
  username.maxLength = 256;
  username.autocomplete = 'off';
  username.autocapitalize = 'none';
  username.spellcheck = false;
  username.dir = 'auto';
  username.placeholder = 'اسم المستخدم';
  username.setAttribute('data-login-focus', 'true');

  const password = document.createElement('input');
  password.id = 'provider-password';
  password.type = 'password';
  password.name = 'password';
  password.required = true;
  password.maxLength = 512;
  password.autocomplete = 'off';
  password.dir = 'auto';
  password.placeholder = 'كلمه المرور';
  password.setAttribute('data-login-focus', 'true');

  let rememberAccount = false;
  const remember = createLoginOption('remember-account', LOGIN_COPY.rememberAccount);
  remember.input.addEventListener('change', () => {
    rememberAccount = remember.input.checked;
  });

  let showPassword = false;
  const visibility = createLoginOption('show-password', LOGIN_COPY.showPassword);
  visibility.input.setAttribute('aria-controls', password.id);
  visibility.input.addEventListener('change', () => {
    showPassword = visibility.input.checked;
    password.type = showPassword ? 'text' : 'password';
  });

  const options = document.createElement('div');
  options.className = 'login-options';
  options.setAttribute('aria-label', 'خيارات تسجيل الدخول');
  options.append(remember.control, visibility.control);

  const submit = createButton(LOGIN_COPY.submit, 'primary-action', 'submit');
  submit.setAttribute('data-login-focus', 'true');

  const feedback = document.createElement('p');
  feedback.className = 'form-feedback';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  if (error) {
    feedback.textContent = error;
    feedback.classList.add('is-error');
  }

  form.append(
    createField('رابط المزود / البوابه', host, 'portal'),
    createField('اسم المستخدم', username, 'user'),
    createField('كلمه المرور', password, 'lock'),
    options,
    submit,
    feedback,
  );
  attachLoginDirectionalNavigation(form);

  let submitting = false;
  const setBusy = (busy: boolean): void => {
    form.setAttribute('aria-busy', String(busy));
    host.disabled = busy;
    username.disabled = busy;
    password.disabled = busy;
    remember.input.disabled = busy;
    visibility.input.disabled = busy;
    submit.disabled = busy;
    submit.classList.toggle('is-loading', busy);
    submit.querySelector('span')!.textContent = busy ? LOGIN_COPY.submitting : LOGIN_COPY.submit;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (!form.reportValidity()) return;

    submitting = true;
    setBusy(true);
    feedback.classList.remove('is-error');
    feedback.textContent = LOGIN_COPY.checking;

    const payload = {
      host: host.value.trim(),
      username: username.value.trim(),
      password: password.value,
      rememberAccount,
    };
    password.value = '';

    try {
      const response = await fetch(appPath('/api/session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        feedback.textContent = response.status === 429
          ? LOGIN_COPY.tooManyAttempts
          : LOGIN_COPY.authenticationFailed;
        feedback.classList.add('is-error');
        return;
      }

      const session = (await response.json()) as BrowserSessionState;
      if (!session.authenticated) throw new Error('Unexpected unauthenticated response.');
      host.value = '';
      username.value = '';
      activeDestination = 'home';
      viewState = Object.freeze({ kind: 'signed-in', session, busy: false, error: null });
      render();
    } catch {
      feedback.textContent = LOGIN_COPY.serviceUnavailable;
      feedback.classList.add('is-error');
    } finally {
      payload.password = '';
      submitting = false;
      if (viewState.kind === 'signed-out') setBusy(false);
    }
  });

  panel.append(heading, form);
  stage.append(brand, panel);
  root.replaceChildren(stage);
}

function attachShellDirectionalNavigation(
  container: HTMLElement,
  orientation: 'horizontal' | 'vertical',
): void {
  container.addEventListener('keydown', (event) => {
    let delta = 0;
    if (orientation === 'vertical') {
      if (event.key === 'ArrowDown') delta = 1;
      else if (event.key === 'ArrowUp') delta = -1;
    } else {
      if (event.key === 'ArrowLeft') delta = 1;
      else if (event.key === 'ArrowRight') delta = -1;
    }
    if (delta === 0) return;

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-nav-destination]'),
    ).filter((button) => !button.disabled);
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (currentIndex < 0 || buttons.length < 2) return;
    event.preventDefault();
    const nextIndex = (currentIndex + delta + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus({ preventScroll: true });
  });
}

function focusNavigationDestination(place: 'sidebar' | 'bottom', id: ShellDestinationId): void {
  queueMicrotask(() => {
    root.querySelector<HTMLButtonElement>(
      `[data-nav-place="${place}"][data-nav-destination="${id}"]`,
    )?.focus({ preventScroll: true });
  });
}

function createNavigation(place: 'sidebar' | 'bottom'): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = place === 'sidebar' ? 'shell-nav shell-nav-sidebar' : 'shell-nav shell-nav-bottom';
  nav.setAttribute('aria-label', 'التنقل الرئيسي');

  for (const destination of SHELL_DESTINATIONS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'shell-nav-item';
    item.dataset.navDestination = destination.id;
    item.dataset.navPlace = place;
    if (destination.id === activeDestination) {
      item.classList.add('is-active');
      item.setAttribute('aria-current', 'page');
    }

    const icon = createIcon(DESTINATION_ICONS[destination.id]);
    const text = document.createElement('span');
    text.textContent = destination.label;
    item.append(icon, text);
    item.addEventListener('click', () => {
      if (destination.id === activeDestination) return;
      activeDestination = destination.id;
      render();
      focusNavigationDestination(place, destination.id);
    });
    nav.append(item);
  }

  attachShellDirectionalNavigation(nav, place === 'sidebar' ? 'vertical' : 'horizontal');
  return nav;
}

async function performLogout(
  session: OpaqueSessionDescriptor,
): Promise<void> {
  if (viewState.kind !== 'signed-in' || viewState.busy) return;
  viewState = Object.freeze({ kind: 'signed-in', session, busy: true, error: null });
  render();
  try {
    const revoked = await requestLogout(fetch, appPath('/api/session'));
    if (revoked) {
      activeDestination = 'home';
      viewState = Object.freeze({ kind: 'signed-out', error: null });
    } else {
      viewState = Object.freeze({
        kind: 'signed-in',
        session,
        busy: false,
        error: 'تعذر تأكيد تسجيل الخروج. قد تظل الجلسة فعالة؛ حاول مرة أخرى.',
      });
    }
  } catch {
    viewState = Object.freeze({
      kind: 'signed-in',
      session,
      busy: false,
      error: 'تعذر تأكيد تسجيل الخروج. قد تظل الجلسة فعالة؛ حاول مرة أخرى.',
    });
  }
  render();
}

function createLogoutButton(
  session: OpaqueSessionDescriptor,
  busy: boolean,
  compact: boolean,
): HTMLButtonElement {
  const button = createButton(
    busy ? 'جارٍ تسجيل الخروج…' : 'تسجيل الخروج',
    compact ? 'shell-logout shell-logout-compact' : 'shell-logout',
  );
  button.prepend(createIcon('logout'));
  button.disabled = busy;
  if (compact) {
    button.setAttribute('aria-label', busy ? 'جارٍ تسجيل الخروج' : 'تسجيل الخروج');
    button.title = busy ? 'جارٍ تسجيل الخروج' : 'تسجيل الخروج';
  }
  button.addEventListener('click', () => {
    void performLogout(session);
  });
  return button;
}

function renderDestinationContent(error: string | null): HTMLElement {
  const destination = SHELL_DESTINATIONS.find((entry) => entry.id === activeDestination);
  if (!destination) throw new Error('Unknown HULK shell destination.');

  const content = document.createElement('main');
  content.className = 'shell-content';
  content.id = 'shell-content';

  const header = document.createElement('header');
  header.className = 'shell-content-header';
  const titleGroup = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'shell-eyebrow';
  eyebrow.textContent = 'HULK SA WEB PLAYER';
  const title = document.createElement('h1');
  title.textContent = destination.label;
  titleGroup.append(eyebrow, title);
  const secureStatus = document.createElement('span');
  secureStatus.className = 'secure-session-chip';
  secureStatus.textContent = 'جلسة آمنة';
  header.append(titleGroup, secureStatus);

  if (error) {
    const notice = document.createElement('p');
    notice.className = 'shell-notice is-error';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.textContent = error;
    content.append(header, notice);
  } else {
    content.append(header);
  }

  const stage = document.createElement('section');
  stage.className = 'shell-stage-card';
  stage.setAttribute('aria-labelledby', 'shell-stage-title');
  const iconWrap = document.createElement('span');
  iconWrap.className = 'shell-stage-icon';
  iconWrap.append(createIcon(DESTINATION_ICONS[destination.id]));
  const stageTitle = document.createElement('h2');
  stageTitle.id = 'shell-stage-title';
  stageTitle.textContent = destination.id === 'home' ? 'مرحباً بك في HULK SA' : destination.label;
  const copy = document.createElement('p');
  copy.textContent = destination.id === 'home'
    ? 'اختر وجهتك من شريط التنقل للوصول إلى أقسام المشغل.'
    : 'لا توجد بيانات مزود معروضة في هذه الواجهة حالياً.';
  stage.append(iconWrap, stageTitle, copy);
  content.append(stage);
  return content;
}

function renderSignedIn(
  session: OpaqueSessionDescriptor,
  busy: boolean,
  error: string | null,
): void {
  activeLoginStage = null;

  const shell = document.createElement('div');
  shell.className = 'authenticated-shell';

  const sidebar = document.createElement('aside');
  sidebar.className = 'shell-sidebar';
  const brand = document.createElement('div');
  brand.className = 'shell-brand';
  brand.append(createBrandImage('lockup', 'brand-lockup'));
  const sidebarNav = createNavigation('sidebar');
  const sidebarFooter = document.createElement('div');
  sidebarFooter.className = 'shell-sidebar-footer';
  const expiry = document.createElement('p');
  expiry.className = 'session-expiry';
  expiry.textContent = `تنتهي الجلسة ${formatSessionExpiry(session.expiresAt)}`;
  sidebarFooter.append(expiry, createLogoutButton(session, busy, false));
  sidebar.append(brand, sidebarNav, sidebarFooter);

  const mobileTopbar = document.createElement('header');
  mobileTopbar.className = 'shell-mobile-topbar';
  mobileTopbar.append(
    createBrandImage('badge', 'shell-mobile-badge'),
    createLogoutButton(session, busy, true),
  );

  const content = renderDestinationContent(error);
  const bottomNav = createNavigation('bottom');

  shell.append(sidebar, mobileTopbar, content, bottomNav);
  root.replaceChildren(shell);
}

function render(): void {
  if (viewState.kind === 'loading') renderLoading();
  else if (viewState.kind === 'signed-out') renderSignedOut(viewState.error);
  else renderSignedIn(viewState.session, viewState.busy, viewState.error);
}

async function hydrateSession(): Promise<void> {
  render();
  try {
    const response = await fetch(appPath('/api/session'), {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      viewState = Object.freeze({ kind: 'signed-out', error: null });
      render();
      return;
    }
    const session = (await response.json()) as BrowserSessionState;
    viewState = session.authenticated
      ? Object.freeze({ kind: 'signed-in', session, busy: false, error: null })
      : Object.freeze({ kind: 'signed-out', error: null });
  } catch {
    viewState = Object.freeze({ kind: 'signed-out', error: 'تعذر التحقق من الجلسة.' });
  }
  render();
}

void hydrateSession();
