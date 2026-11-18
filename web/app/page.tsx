import type { Metadata } from 'next';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource-variable/dm-sans';
import ClubLanding from '../components/club/ClubLanding';
import './club.css';

export const metadata: Metadata = {
  title: 'Strikz Club | Indoor cricket & futsal in Homagama',
  description: 'Explore Strikz Club in Pitipana, Homagama. Check indoor cricket availability, book a session, and find the arena.',
};

export default function Page() {
  return <ClubLanding />;
}
