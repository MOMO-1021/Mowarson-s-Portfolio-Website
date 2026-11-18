// script.js – smooth scrolling, hamburger menu, and dropdown navigation
document.addEventListener('DOMContentLoaded', function() {
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.error || 'Unable to send your inquiry. Please try again.');
        }

        contactForm.reset();
        status.textContent = result.message || 'Thank you! Your inquiry has been received.';
      } catch (error) {
        status.textContent = error.message || 'Unable to send your inquiry. Please try again.';
        status.classList.add('is-error');
      } finally {
        submitButton.disabled = false;
      }
    });
  }
});
