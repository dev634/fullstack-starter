import Link from "next/link";

type LinkProps = {
    href: string;
    display: string;
}

export default function Navbar({links}:{links: LinkProps[]}) {
  return (
      <nav className="flex justify-center bg-gray-800 text-white py-4">
        <div className="container w-8/12 flex justify-between items-center">
          <div className="text-lg font-bold">Fullstack Starter</div>
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