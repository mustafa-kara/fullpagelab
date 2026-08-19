import { render } from 'preact';
import '../ui/tokens.css';

export function renderPage(title: string, description: string): void {
  render(<main class="page"><header class="header"><strong>PageShot</strong><span class="muted">{title}</span></header><section class="card"><p>{description}</p></section></main>, document.getElementById('app')!);
}
