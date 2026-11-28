// script.js – smooth scrolling, hamburger menu, and dropdown navigation
document.addEventListener('DOMContentLoaded', function() {
  const consentKey = 'mowarson_analytics_consent';
  const campaignKey = 'mowarson_campaign_attribution';
  const channelPatterns = [
    ['facebook', /facebook\.com|fb\.com/i],
    ['instagram', /instagram\.com/i],
    ['linkedin', /linkedin\.com/i],
    ['threads', /threads\.com/i],
    ['x', /(?:^|\/)(?:x\.com|twitter\.com)(?:\/|$)/i],
    ['whatsapp', /wa\.me|api\.whatsapp\.com\/send|whatsapp\.com/i],
    ['blog', /mowarsondeveloper-blog-website\.netlify\.app/i]
  ];

  function getConsent() {
    return localStorage.getItem(consentKey) || '';
  }

  function setConsent(granted) {
    localStorage.setItem(consentKey, granted ? 'granted' : 'denied');
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', {
        analytics_storage: granted ? 'granted' : 'denied',
        ad_storage: granted ? 'granted' : 'denied',
        ad_user_data: granted ? 'granted' : 'denied',
        ad_personalization: granted ? 'granted' : 'denied'
      });
    }
    if (window.posthog) {
      if (granted) {
        window.posthog.opt_in_capturing();
        if (!sessionStorage.getItem('mowarson_posthog_pageview_captured')) {
          window.posthog.capture('$pageview', {
            $current_url: window.location.href,
            page_path: window.location.pathname,
            ...attribution
          });
          sessionStorage.setItem('mowarson_posthog_pageview_captured', 'true');
        }
      } else {
        window.posthog.opt_out_capturing();
      }
    }
  }

  function capture(eventName, properties = {}) {
    if (typeof window.gtag === 'function') window.gtag('event', eventName, properties);
    if (window.posthog && typeof window.posthog.capture === 'function') {
      window.posthog.capture(eventName, properties);
    }
  }

  function getChannel(url) {
    for (const [channel, pattern] of channelPatterns) {
      if (pattern.test(url)) return channel;
    }
    return 'website';
  }

  const params = new URLSearchParams(window.location.search);
  const campaignFields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'gclid', 'fbclid', 'msclkid'];
  const campaign = {};
  campaignFields.forEach((field) => {
    const value = params.get(field);
    if (value) campaign[field] = value.slice(0, 200);
  });
  if (Object.keys(campaign).length) {
    localStorage.setItem(campaignKey, JSON.stringify(campaign));
  }
  let attribution = {};
  try {
    attribution = JSON.parse(localStorage.getItem(campaignKey) || '{}');
  } catch {
    attribution = {};
  }
  attribution.channel = getChannel(document.referrer || window.location.href);

  if (typeof window.gtag === 'function') {
    window.gtag('set', 'user_properties', {
      marketing_channel: attribution.channel,
      utm_source: attribution.utm_source || '(direct)',
      utm_medium: attribution.utm_medium || '(none)',
      utm_campaign: attribution.utm_campaign || '(none)'
    });
  }
  if (window.posthog && typeof window.posthog.register === 'function') {
    window.posthog.register(attribution);
  }

  const consent = getConsent();
  if (!consent) {
    const banner = document.createElement('div');
    banner.className = 'analytics-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Analytics consent');
    banner.innerHTML =
      '<div><strong>Help improve Mowarson Developer</strong><p>We use analytics and advertising cookies to understand channel performance and improve this website.</p></div>' +
      '<div class="analytics-consent-actions">' +
      '<button type="button" data-consent="accept">Accept</button>' +
      '<button type="button" data-consent="decline">Decline</button>' +
      '</div>';
    document.body.appendChild(banner);
    banner.querySelector('[data-consent="accept"]').addEventListener('click', function () {
      setConsent(true);
      banner.remove();
    });
    banner.querySelector('[data-consent="decline"]').addEventListener('click', function () {
      setConsent(false);
      banner.remove();
    });
  } else {
    setConsent(consent === 'granted');
  }

  document.querySelectorAll('a[href]').forEach((anchor) => {
    anchor.addEventListener('click', function () {
      const url = anchor.href;
      if (!url) return;
      const channel = getChannel(url);
      const isExternal = new URL(url, window.location.href).origin !== window.location.origin;
      if (isExternal) {
        capture('outbound_click', {
          destination_domain: new URL(url, window.location.href).hostname,
          destination_channel: channel,
          link_text: (anchor.textContent || '').trim().slice(0, 120),
          ...attribution
        });
      }
    });
  });

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId && targetId !== '#') {
        const target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  });

  // Logo click: smooth scroll to top on home page without bouncing/reloading
  document.querySelectorAll('.logo').forEach(logo => {
    logo.addEventListener('click', function(e) {
      const path = window.location.pathname;
      const isHome = path.endsWith('index.html') || path === '/' || path === '';
      const href = this.getAttribute('href') || '';
      if (isHome && (href.endsWith('index.html') || href === '/' || href === '#')) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });

  // Hamburger menu toggle
  const hamburger = document.querySelector('.hamburger');
  const nav = document.querySelector('.nav');
  if (hamburger && nav) {
    hamburger.addEventListener('click', function() {
      this.classList.toggle('active');
      nav.classList.toggle('active');
    });
  }

  // Dropdown hover for desktop + click for mobile
  const dropdowns = document.querySelectorAll('.dropdown');
  let timeoutId;

  function dropdownClickHandler(e) {
    // Prevent closing if clicking inside dropdown content
    if (e.target.closest('.dropdown-content')) return;
    const dropdown = e.currentTarget;
    dropdown.classList.toggle('open');
  }

  function handleResize() {
    if (window.innerWidth > 768) {
      // Desktop: hover behavior
      dropdowns.forEach(dropdown => {
        dropdown.removeEventListener('click', dropdownClickHandler);
        dropdown.addEventListener('mouseenter', function() {
          clearTimeout(timeoutId);
          this.classList.add('open');
        });
        dropdown.addEventListener('mouseleave', function() {
          timeoutId = setTimeout(() => {
            this.classList.remove('open');
          }, 200);
        });
      });
    } else {
      // Mobile: click behavior
      dropdowns.forEach(dropdown => {
        dropdown.addEventListener('click', dropdownClickHandler);
      });
    }
  }

  // Initial call
  handleResize();
  window.addEventListener('resize', handleResize);

  // Showcase Drawers (Expandable Portfolio & Tech Stack)
  const drawerTriggers = document.querySelectorAll('.showcase-drawer-trigger');
  drawerTriggers.forEach(trigger => {
    trigger.addEventListener('click', function() {
      const drawer = this.closest('.showcase-drawer');
      if (!drawer) return;
      const isOpen = drawer.classList.contains('is-open');
      const label = this.querySelector('.toggle-label');
      const openText = this.getAttribute('data-open-text') || 'Close';
      const closedText = this.getAttribute('data-closed-text') || 'View';

      if (isOpen) {
        drawer.classList.remove('is-open');
        this.setAttribute('aria-expanded', 'false');
        if (label) label.textContent = closedText;
      } else {
        drawer.classList.add('is-open');
        this.setAttribute('aria-expanded', 'true');
        if (label) label.textContent = openText;
      }
    });
  });

  const contactForm = document.querySelector('#contact-form');
  if (contactForm) {
    const status = document.querySelector('#contact-form-status');
    const submitButton = contactForm.querySelector('button[type="submit"]');

    contactForm.addEventListener('submit', async function(event) {
      event.preventDefault();
      if (!contactForm.reportValidity()) return;

      const formData = new FormData(contactForm);
      const payload = Object.fromEntries(formData.entries());
      payload.consent = formData.has('consent');
      status.textContent = 'Sending your inquiry…';
      status.classList.remove('is-error');
      submitButton.disabled = true;

      try {
        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.error || 'Unable to send your inquiry. Please try again.');
        }

        try {
          sessionStorage.setItem('mowarson_last_inquiry', JSON.stringify({
            name: payload.name || '',
            service: payload.service || 'SEO-Optimized Website & Monthly SEO Packages (Rs. 8,000)',
            message: payload.message || ''
          }));
        } catch {}

        if (window.posthog && typeof window.posthog.capture === 'function') {
          window.posthog.capture('contact_inquiry_submitted', {
            marketing_consent: payload.consent
          });
        }
        if (typeof window.gtag === 'function') {
          window.gtag('event', 'generate_lead', {
            lead_type: 'contact_inquiry',
            marketing_consent: payload.consent,
            service: payload.service || '(not specified)',
            ...attribution
          });
        }
        if (window.posthog && typeof window.posthog.capture === 'function') {
          window.posthog.capture('generate_lead', { email: payload.email });
        }
        if (result.redirectTo) {
          window.location.assign(result.redirectTo);
        } else {
          throw new Error('The form was submitted, but the thank-you redirect was not available.');
        }
      } catch (error) {
        status.textContent = error.message || 'Unable to send your inquiry. Please try again.';
        status.classList.add('is-error');
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  document.querySelectorAll('.formkit-form').forEach((form) => {
    form.addEventListener('submit', function () {
      capture('newsletter_signup_started', {
        form_location: window.location.pathname,
        ...attribution
      });
    });
  });

  document.querySelectorAll('a[href*="/pay"], a[href*="pay.html"], a[href*="service="]').forEach((link) => {
    link.addEventListener('click', function () {
      capture('service_interest', {
        destination: link.href,
        link_text: (link.textContent || '').trim().slice(0, 120),
        ...attribution
      });
    });
  });

  document.querySelectorAll('a[href*="wa.me"], a[href*="api.whatsapp.com/send"], a[href*="whatsapp.com"]').forEach((link) => {
    if (link.href.includes('wa.me/')) {
      const oldUrl = new URL(link.href);
      const text = oldUrl.searchParams.get('text');
      const apiUrl = new URL('https://api.whatsapp.com/send/');
      apiUrl.searchParams.set('phone', '916009825938');
      if (text) apiUrl.searchParams.set('text', text);
      link.href = apiUrl.toString();
    }

    link.addEventListener('click', function () {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'whatsapp_click',
        link_url: link.href
      });
      capture('whatsapp_click', {
        link_text: (link.textContent || '').trim().slice(0, 120),
        ...attribution
      });
    });
  });

  const scrollMilestones = [25, 50, 75, 90];
  const recordedMilestones = new Set();
  let scrollScheduled = false;
  window.addEventListener('scroll', function () {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(function () {
      scrollScheduled = false;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      const percent = Math.round((window.scrollY / scrollable) * 100);
      scrollMilestones.forEach((milestone) => {
        if (percent >= milestone && !recordedMilestones.has(milestone)) {
          recordedMilestones.add(milestone);
          capture('scroll_depth', {
            percent: milestone,
            page_path: window.location.pathname,
            ...attribution
          });
        }
      });
    });
  }, { passive: true });
});
