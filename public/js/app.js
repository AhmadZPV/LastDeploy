const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
if (csrf) {
  for (const form of document.querySelectorAll('form[method="post"], form[method="POST"]')) {
    if (!form.querySelector('input[name="_csrf"]')) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = '_csrf';
      input.value = csrf;
      form.appendChild(input);
    }
  }
}

for (const toggle of document.querySelectorAll('[data-theme-toggle]')) {
  const syncThemeLabel = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    toggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    toggle.setAttribute('aria-pressed', String(dark));
  };
  syncThemeLabel();
  toggle.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('erwin-theme', theme);
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const dark = theme === 'dark';
      button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      button.setAttribute('aria-pressed', String(dark));
    });
  });
}

for (const source of document.querySelectorAll('textarea[data-rich-text]')) {
  const editor = document.createElement('div');
  editor.className = 'rich-text-editor';
  editor.contentEditable = 'true';
  editor.innerHTML = source.value;
  source.hidden = true;
  source.before(editor);
  source.form?.addEventListener('submit', () => { source.value = editor.innerHTML; });
}

const navToggle = document.querySelector('[data-nav-toggle]');
const closeNavigation = () => {
  document.body.classList.remove('nav-open');
  navToggle?.setAttribute('aria-expanded', 'false');
};
navToggle?.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  navToggle.setAttribute('aria-expanded', String(open));
});
document.querySelector('[data-nav-close]')?.addEventListener('click', closeNavigation);

const navSections = [...document.querySelectorAll('[data-nav-section]')];
const storedSection = localStorage.getItem('erwin-nav-section');
for (const section of navSections) {
  const trigger = section.querySelector('[data-nav-section-trigger]');
  const panel = section.querySelector('.nav-section-panel');
  if (!trigger || !panel) continue;
  if (!section.classList.contains('has-active') && storedSection === section.dataset.navSection) {
    section.classList.add('is-open');
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }
  trigger.addEventListener('click', () => {
    const opening = !section.classList.contains('is-open');
    for (const other of navSections) {
      if (other === section) continue;
      other.classList.remove('is-open');
      const otherPanel = other.querySelector('.nav-section-panel');
      const otherTrigger = other.querySelector('[data-nav-section-trigger]');
      if (otherPanel) otherPanel.hidden = true;
      otherTrigger?.setAttribute('aria-expanded', 'false');
    }
    section.classList.toggle('is-open', opening);
    panel.hidden = !opening;
    trigger.setAttribute('aria-expanded', String(opening));
    if (opening) localStorage.setItem('erwin-nav-section', section.dataset.navSection || '');
    else localStorage.removeItem('erwin-nav-section');
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeNavigation();
});

for (const notification of document.querySelectorAll('[data-notification]')) {
  const dismiss = () => {
    notification.classList.add('is-leaving');
    notification.addEventListener('animationend', () => notification.remove(), { once: true });
  };
  notification.querySelector('[data-notification-close]')?.addEventListener('click', dismiss);
  if (notification.classList.contains('notification-success')) setTimeout(dismiss, 5000);
}
