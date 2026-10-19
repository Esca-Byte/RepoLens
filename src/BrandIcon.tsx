export const repoLensIconUrl = '/repolens-icon.svg';

export default function BrandIcon({ className = '' }: { className?: string }) {
  return <img className={`repolens-icon ${className}`.trim()} src={repoLensIconUrl} alt="" aria-hidden="true" />;
}
