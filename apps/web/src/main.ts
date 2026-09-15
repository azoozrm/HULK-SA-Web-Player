const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('HULK SA Web Player root element is missing.');
}

const card = document.createElement('section');
card.className = 'foundation-card';
card.setAttribute('aria-labelledby', 'foundation-title');

const title = document.createElement('h1');
title.id = 'foundation-title';
title.textContent = 'HULK SA Web Player';

const description = document.createElement('p');
description.textContent =
  'تم تأسيس البنية الهندسية للمشغل. تسجيل الدخول والمكتبات والتشغيل ليست ضمن هذه المرحلة.';

card.append(title, description);
root.replaceChildren(card);
