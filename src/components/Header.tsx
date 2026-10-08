import Logo from "../assets/Alfred_Logo.png";


interface HeaderProps {
  onGoHome?: () => void;
}

export default function Header({ onGoHome }: HeaderProps) {


  return (
    <header className="Header">
      <div
        className="HeaderBrand"
        onClick={onGoHome}
        role={onGoHome ? "button" : undefined}
        tabIndex={onGoHome ? 0 : undefined}
        style={{ cursor: onGoHome ? "pointer" : "default" }}
      >
        <img src={Logo} alt="Alfred Logo" />
        <h1>ALFRED</h1>
      </div>
    </header>
  );
}