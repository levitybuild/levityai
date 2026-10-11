import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'Levity AI — code with clarity', description: 'An AI-powered code editor with safe, API-owned tool calling.' }
export const viewport: Viewport = { themeColor: '#0f8f87', width: 'device-width', initialScale: 1, userScalable: false }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html> }
