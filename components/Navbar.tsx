import Link from "next/link";

type NavbarProps = {
    brand: LinkProps
    links: LinkProps[];
}

type LinkProps = {
    href: string;
    display: string;
}

export default function Navbar({ brand, links }: NavbarProps) {
  return (
      <nav className="flex justify-center bg-gray-800 text-white py-4 px-6 mb-6">
        <div className="flex justify-between items-center w-full">
          <Link href={brand.href} className="text-lg font-bold">
            {brand.display}
          </Link>
          <div className="space-x-4">
            {!links.length && <span>No links available</span>}
            {links.map((link) => ( 
              <Link key={link.href} href={link.href} className="hover:text-gray-400">
                {link.display}
              </Link>
                ))}
            </div> 
        </div>
      </nav>
    );
}