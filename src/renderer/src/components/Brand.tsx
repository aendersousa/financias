interface BrandProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export default function Brand({ size = 'md', className = '' }: BrandProps) {
  return (
    <span className={`walletup-brand walletup-brand-${size} ${className}`}>
      <span className="walletup-mark" aria-hidden="true">
        <img src={`${import.meta.env.BASE_URL}brand/wallet-mark.png`} alt="" />
      </span>
      <span className="walletup-wordmark">Wallet<span className="walletup-up">Up</span></span>
    </span>
  )
}
