import type { Metadata } from 'next';
import './globals.css';

const siteUrl = process.env.SITE_URL ?? 'https://psychologyKM.github.io/diagramMaker/';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: '連関図 | Relation Map',
  description: '原因と結果を視覚的につなげて整理できる、個人用の連関図エディター。',
  openGraph: {
    title: '連関図',
    description: '原因と結果を、つないで考える。',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: '連関図エディター' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '連関図',
    description: '原因と結果を、つないで考える。',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
