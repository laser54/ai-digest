export function renderNextPageButton(container, cursor, onNext) {
  if (!cursor) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Следующие выпуски';
  button.addEventListener('click', () => onNext(cursor));
  container.append(button);
  return button;
}
