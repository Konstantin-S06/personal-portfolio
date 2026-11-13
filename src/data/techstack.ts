export interface TechGroup {
  label: string;
  items: readonly string[];
}

/** Skills used across the featured and additional projects. */
export const techStack: readonly TechGroup[] = [
  {
    label: 'Languages',
    items: ['TypeScript', 'Python', 'C++', 'C', 'Java', 'Power Fx', 'GLSL'],
  },
  {
    label: 'Frontend',
    items: ['React', 'Astro', 'Three.js', 'HTML', 'CSS', 'Tailwind CSS'],
  },
  {
    label: 'Backend',
    items: ['Flask', 'FastAPI', 'SQLite', 'PostgreSQL', 'Firebase', 'SharePoint'],
  },
  {
    label: 'AI',
    items: ['PyTorch', 'Gymnasium', 'Stable-Baselines3', 'Gemini'],
  },
  {
    label: 'Tools',
    items: ['Git', 'Vite', 'CMake', 'GitHub Actions', 'Azure DevOps', 'Power Apps', 'Power Automate'],
  },
];
