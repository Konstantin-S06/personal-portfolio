import type { CSSProperties } from 'react';
import { techTags, type Project } from '../lib/projects';

/**
 * The remaining (non-featured) projects as one row of cards. In the pinned scene CSS bends the row into an
 * arc around the campfire; in flat mode it is a plain grid. --o is each card's offset from the centre
 * (-2, -1, 0, 1, 2 for five cards).
 */
export function MoreArc({ title, projects }: { title: string; projects: Project[] }) {
  const n = projects.length;
  return (
    <div className="more-arc-wrap">
      <h2 className="more-title">{title}</h2>
      <ul className="more-arc">
        {projects.map((p, i) => {
          const style = { '--o': i - (n - 1) / 2 } as CSSProperties;
          const tags = techTags(p.tech_stack).slice(0, 3);
          return (
            <li className="more-card" key={p.id} style={style}>
              {p.context && <p className="more-context">{p.context}</p>}
              <h3>{p.title}</h3>
              <p className="more-summary">{p.summary ?? p.description}</p>
              {tags.length > 0 && (
                <div className="more-tags">
                  {tags.map((t) => (
                    <span className="more-tag" key={t}>{t}</span>
                  ))}
                </div>
              )}
              {(p.github_url || p.demo_url) && (
                <div className="more-links">
                  {p.github_url && (
                    <a href={p.github_url} target="_blank" rel="noopener noreferrer">GitHub</a>
                  )}
                  {p.demo_url && (
                    <a href={p.demo_url} target="_blank" rel="noopener noreferrer">Demo</a>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
