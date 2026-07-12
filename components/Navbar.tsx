"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import ThemeToggle from "@/components/ThemeToggle";
import LocaleToggle from "@/components/LocaleToggle";
import { useTranslation } from "@/components/LocaleProvider";

type NavbarProps = {
    brand: LinkProps
    links: LinkProps[];
    action?: React.ReactNode;
}

type LinkProps = {
    href: string;
    display: string;
}

export default function Navbar({ brand, links, action }: NavbarProps) {
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const { t } = useTranslation();

  // Only render navigation controls when there is something to show
  // (e.g. once the user is logged in). Otherwise just the brand is shown.
  const hasMenu = links.length > 0 || action != null;

  // Close the mobile menu when clicking anywhere outside the navbar.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
      <nav ref={navRef} className="relative bg-gray-800 text-white py-4 px-6 mb-6">
        <div className="flex justify-between items-center w-full">
          <Link href={brand.href} className="text-lg font-bold" onClick={() => setOpen(false)}>
            {brand.display}
          </Link>

          <div className="flex items-center gap-3">
            <LocaleToggle />
            <ThemeToggle />

            {hasMenu && (
              <>
                {/* Desktop menu */}
                <div className="hidden md:flex items-center space-x-4">
                  {links.map((link) => (
                    <Link key={link.href} href={link.href} className="hover:text-gray-400">
                      {link.display}
                    </Link>
                      ))}
                  {action}
                </div>

                {/* Mobile hamburger button (square with 3 bars) */}
                <button
                  type="button"
                  aria-label={t.nav.toggleMenu}
                  aria-expanded={open}
                  onClick={() => setOpen((v) => !v)}
                  className="md:hidden flex items-center justify-center w-10 h-10 rounded border border-white/30 hover:bg-white/10 cursor-pointer"
                >
                  {open ? <XMarkIcon className="w-6 h-6" /> : <Bars3Icon className="w-6 h-6" />}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {hasMenu && open && (
          <div className="md:hidden absolute left-0 right-0 top-full z-50 flex flex-col space-y-3 bg-gray-800 px-6 py-4 border-t border-white/10">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="hover:text-gray-400"
                onClick={() => setOpen(false)}
              >
                {link.display}
              </Link>
            ))}
            {action}
          </div>
        )}
      </nav>
    );
}
