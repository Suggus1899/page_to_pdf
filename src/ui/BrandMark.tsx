interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className = '' }: BrandMarkProps) {
  return (
    <img
      className={'brand-mark ' + className}
      src="/brand-mark.svg"
      alt=""
      aria-hidden="true"
    />
  );
}
