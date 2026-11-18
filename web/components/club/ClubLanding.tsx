'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

const links = [
  { id: 'home', label: 'Home' },
  { id: 'sports', label: 'Sports' },
  { id: 'arena', label: 'The arena' },
  { id: 'faq', label: 'FAQs' },
];

const questions = [
  ['Where is Strikz Club?', 'Strikz Club is in Pitipana, Homagama, near NSBM. Use the directions link in the arena section to find the venue.'],
  ['Can we play late at night?', 'The indoor arena is open 24 hours. Check the booking page for scheduled cricket slots, including late-night and early-morning sessions.'],
  ['How do I book cricket or futsal?', 'For cricket, choose an available session on the booking page and sign in or create your player account. For futsal, call 070 126 1966 to arrange your session with the club.'],
  ['When is my slot confirmed?', 'Your booking page shows the current reservation and payment status. An unpaid hold reserves your slot until its displayed expiry. Contact the club to arrange payment or confirm any special requirements.'],
];

const sports = [
  { name: 'Cricket', value: 'cricket', image: 'cricket', description: 'Find your next cricket session' },
  { name: 'Futsal', value: 'futsal', image: 'futsal', description: 'Get your squad on the court' },
];

const venuePhotos = [
  { image: 'arena', caption: 'Street view', alt: 'Illuminated Strikz Club sign and the entrance facing the road in Pitipana' },
  { image: 'match', caption: 'On the turf', alt: 'Players at the crease under the lights inside the netted arena' },
  { image: 'club', caption: 'Courtside at night', alt: 'The floodlit turf and side netting beneath the Strikz Club sign' },
];

const directions = 'https://www.google.com/maps/search/?api=1&query=Strikz+Club+Pitipana+Homagama';

function SiteHeader() {
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState('home');

  useEffect(() => {
    let frame = 0;
    const sections = links.slice(1).map(({ id }) => document.getElementById(id)).filter((section): section is HTMLElement => Boolean(section));
    function update() {
      frame = 0;
      const threshold = (header.current?.offsetHeight ?? 72) + window.innerHeight * 0.2;
      let current = 'home';
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= threshold) current = section.id;
      }
      setActive(current);
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    const desktop = window.matchMedia('(min-width: 761px)');
    function changeLayout() {
      if (desktop.matches) setMenuOpen(false);
      schedule();
    }
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    desktop.addEventListener('change', changeLayout);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      desktop.removeEventListener('change', changeLayout);
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function dismiss(event: Event) {
      if (event.target instanceof Node && !header.current?.contains(event.target)) setMenuOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        toggle.current?.focus();
      }
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  return <header className="clubHeader" ref={header}>
    <div className="wrap clubHeaderInner">
      <a className="clubBrand clubHeaderBrand" href="#home" aria-label="Strikz Club home" onClick={() => setMenuOpen(false)}>
        <i aria-hidden="true" className="mark"><b/><b/><b/></i><strong>STRIKZ<span> CLUB</span></strong>
      </a>
      <Link className="clubHeaderBook" href="/book?sport=cricket" onClick={() => setMenuOpen(false)}>Book a slot <span aria-hidden="true">↗</span></Link>
      <button type="button" className="clubHeaderToggle" aria-expanded={menuOpen} aria-controls="club-navigation"
        aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} ref={toggle} onClick={() => setMenuOpen(!menuOpen)}>
        <i aria-hidden="true"/><i aria-hidden="true"/>
      </button>
      <nav id="club-navigation" className="clubHeaderNav" data-open={menuOpen} aria-label="Main navigation">
        {links.map(({ id, label }) => <a key={id} href={'#' + id} aria-current={active === id ? 'location' : undefined} onClick={() => setMenuOpen(false)}>{label}</a>)}
      </nav>
    </div>
  </header>;
}

function Walkthrough() {
  const movie = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  function play() {
    void movie.current?.play().catch(() => setPlaying(false));
  }

  useEffect(() => {
    const video = movie.current;
    if (!video) return;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    function configure() {
      if (preference.matches) video?.pause();
      else play();
    }
    configure();
    preference.addEventListener('change', configure);
    return () => {
      preference.removeEventListener('change', configure);
      video.pause();
    };
  }, []);

  return <section className="hero" aria-labelledby="hero-heading">
    <video className="walkthrough" ref={movie} muted playsInline loop preload="none" onPlaying={() => setPlaying(true)}
      onPause={() => setPlaying(false)} onError={() => setUnavailable(true)} poster="/strikz/images/walkthrough-poster.webp" aria-hidden="true">
      <source media="(max-width: 760px)" src="/strikz/media/arena-walkthrough-mobile.mp4" type="video/mp4"/>
      <source src="/strikz/media/arena-walkthrough.mp4" type="video/mp4" onError={() => setUnavailable(true)}/>
    </video>
    <div className="shade" aria-hidden="true"/>
    <div className="wrap heroInner">
      <div className="heroCopy">
        <p className="rubric"><span className="signal" aria-hidden="true"/> Pitipana, Homagama</p>
        <h1 id="hero-heading"><span>GAME ON.</span><em>LIGHTS ON.</em></h1>
        <p className="heroLead">Indoor cricket &amp; futsal, around the clock.<br/>Bring your squad to the turf near NSBM.</p>
        <div className="actions">
          <Link className="cta" href="/book?sport=cricket">Book your slot <span aria-hidden="true">→</span></Link>
          <a className="heroExplore" href="#sports">Explore sports <span aria-hidden="true">↓</span></a>
        </div>
      </div>
      <div className="heroRail">
        <div className="hoursCue"><b aria-hidden="true"/> Open 24 hours</div>
        {!unavailable && <button type="button" className="movieControl" onClick={() => playing ? movie.current?.pause() : play()}>
          <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>{playing ? 'Pause tour' : 'Play tour'}
        </button>}
      </div>
    </div>
  </section>;
}

function VenueGallery() {
  const [index, setIndex] = useState(0);
  const photo = venuePhotos[index];
  const move = (direction: number) => setIndex((current) => (current + direction + venuePhotos.length) % venuePhotos.length);
  return <figure className="venuePhoto" data-reveal aria-label="Venue photos">
    <Image key={photo.image} src={'/strikz/images/' + photo.image + '.webp'} alt={photo.alt} width={768} height={1020} sizes="(max-width: 760px) 90vw, 50vw"/>
    <figcaption><span aria-live="polite"><small>{index + 1} / {venuePhotos.length}</small>{photo.caption}</span>
      <span className="galleryControls">
        <button type="button" aria-label="Previous venue photo" onClick={() => move(-1)}>←</button>
        <button type="button" aria-label="Next venue photo" onClick={() => move(1)}>→</button>
      </span>
    </figcaption>
  </figure>;
}

function ClubContent() {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('has-entered');
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.08 });
    content.current?.querySelectorAll('[data-reveal]').forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  return <div ref={content}>
    <section className="sportsSection" id="sports" aria-labelledby="sports-heading">
      <div className="wrap">
        <div className="sportsHead" data-reveal>
          <div><p className="rubric"><b className="line"/> The sports</p><h2 id="sports-heading" className="displayTitle">PICK YOUR <em>GAME.</em></h2></div>
          <p className="sportsIntro">Choose your sport and bring your squad.<br/>We’ll see you on the turf.</p>
        </div>
        <div className="sportGrid">{sports.map((sport) => <Link className="sportCard" key={sport.name} href={'/book?sport=' + sport.value}
          aria-label={'Book indoor ' + sport.name.toLowerCase()} data-reveal>
          <Image src={'/strikz/images/' + sport.image + '.webp'} alt="" width={640} height={420} sizes="(max-width: 760px) 90vw, 45vw"/>
          <span className="sportDetails"><strong>{sport.name}</strong><span>{sport.description}</span></span><span className="cardArrow" aria-hidden="true">↗</span>
        </Link>)}</div>
      </div>
    </section>
    <section className="arenaFeature" id="arena" aria-labelledby="arena-heading">
      <div className="wrap arenaGrid">
        <VenueGallery/>
        <div className="venueCopy" data-reveal>
          <p className="rubric"><b className="line"/> The arena</p><h2 id="arena-heading" className="displayTitle">FIND THE<br/><em>ARENA.</em></h2>
          <p>Look for the Strikz Club sign in Pitipana, near NSBM. The covered turf is open for cricket and futsal day and night.</p>
          <dl className="venueFacts"><div><dt>Playing hours</dt><dd>24 hours daily</dd></div><div><dt>Location</dt><dd>Pitipana, Homagama</dd></div></dl>
          <a className="venueLink" href={directions} target="_blank" rel="noopener noreferrer">Get directions <span aria-hidden="true">↗</span></a>
        </div>
      </div>
    </section>
    <section className="faqSection" id="faq" aria-labelledby="faq-heading">
      <div className="wrap faqGrid">
        <div data-reveal><p className="rubric"><b className="line"/> Booking help</p><h2 id="faq-heading" className="displayTitle">COURT<br/><em>QUESTIONS.</em></h2></div>
        <div className="faqList" data-reveal>{questions.map(([question, answer]) => <details key={question}>
          <summary>{question}<span aria-hidden="true"/></summary><p>{answer}</p>
        </details>)}</div>
      </div>
    </section>
  </div>;
}

function SiteFooter() {
  return <footer className="club-footer" aria-label="Strikz Club footer">
    <div className="wrap club-footer-inner">
      <div className="club-footer-main">
        <div className="club-footer-identity">
          <a className="club-footer-wordmark" href="#home" aria-label="Strikz Club home">STRIKZ <span>CLUB</span></a>
          <p>24-hour indoor cricket &amp; futsal arena</p>
          <a className="club-footer-location" href={directions} target="_blank" rel="noopener noreferrer">Pitipana, Homagama · Near NSBM <span aria-hidden="true">↗</span></a>
        </div>
        <nav className="club-footer-links" aria-label="Footer navigation">
          <h2>Explore</h2><a href="#sports">Sports</a><a href="#arena">The arena</a><a href="#faq">FAQs</a><Link href="/book">Book a session</Link>
        </nav>
        <div className="club-footer-contact">
          <h2>Bookings</h2><a className="club-footer-phone" href="tel:+94701261966">070 126 1966</a>
          <Link className="club-footer-book" href="/book?sport=cricket">Book a slot <span aria-hidden="true">↗</span></Link>
        </div>
      </div>
      <div className="club-footer-base">
        <span>© {new Date().getUTCFullYear()} Strikz Club Pvt Ltd</span>
        <a href="https://techwing.cloud/" className="club-footer-credit" target="_blank" rel="noopener noreferrer">Powered by <strong>Techwing Solutions Pvt Ltd</strong> <span aria-hidden="true">↗</span></a>
      </div>
    </div>
  </footer>;
}

export default function ClubLanding() {
  return <div id="home" className="club-site">
    <a className="skipLink" href="#sports">Skip to sports and bookings</a>
    <SiteHeader/>
    <main><Walkthrough/><ClubContent/></main>
    <SiteFooter/>
  </div>;
}

