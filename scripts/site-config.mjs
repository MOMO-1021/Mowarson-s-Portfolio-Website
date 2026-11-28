/**
 * Centralized Site Configuration
 * Single source of truth for site-wide metadata, organization details,
 * services, blog posts, and SEO settings.
 */

export const siteConfig = {
  // Core site properties
  productionUrl: "https://mowarsondeveloper.netlify.app",
  siteName: "Mowarson Developer",
  organizationName: "Mowarson Developer",
  logo: "https://mowarsondeveloper.netlify.app/assets/favicon.png",
  defaultLanguage: "en-IN",
  defaultImage: "https://mowarsondeveloper.netlify.app/My-Image.jpg",

  // Social profiles
  socialProfiles: [
    "https://www.linkedin.com/in/mowarson-developer-298404302/",
    "https://www.instagram.com/mowarson_developer/",
    "https://www.facebook.com/profile.php?id=61596554436022",
    "https://x.com/MowarsonDev",
    "https://www.threads.com/@mowarson_developer"
  ],

  // Contact details
  contactDetails: {
    email: "mowarsondeveloper@gmail.com",
    telephone: "+916009825938",
    contactType: "customer service",
    areaServed: "India"
  },

  // Analytics & Tag Manager
  integrations: {
    ga4Id: "G-S7P05N251P",
    gtmId: "GTM-5N6TFGZT",
    posthogScript: "/posthog-init.js",
    metaPixelId: "2390185648395048",
    blogDomain: "mowarsondeveloper-blog-website.netlify.app"
  },

  // Service offerings (used on services.html and index.html)
  services: [
    {
      id: "service-seo-website",
      name: "SEO-Optimized Website & Monthly SEO Packages",
      description: "Complete SEO-optimized website design paired with monthly SEO packages, local Business SEO, Technical SEO, and SEO blog management to maximize online visibility and convert prospective customers.",
      price: "8000",
      priceCurrency: "INR",
      url: "https://mowarsondeveloper.netlify.app/pay.html?service=seo",
      category: "SEO & Web Design"
    }
  ],

  // Page definitions & metadata
  pages: {
    "index.html": {
      canonical: "https://mowarsondeveloper.netlify.app/",
      priority: "1.0",
      changefreq: "weekly",
      schemas: ["WebSite", "Organization", "ProfessionalService"]
    },
    "services.html": {
      canonical: "https://mowarsondeveloper.netlify.app/services.html",
      priority: "0.95",
      changefreq: "monthly",
      schemas: ["CollectionPage", "Service", "Offer"]
    },
    "about.html": {
      canonical: "https://mowarsondeveloper.netlify.app/about.html",
      priority: "0.85",
      changefreq: "monthly",
      schemas: ["AboutPage", "Person"]
    },
    "contact.html": {
      canonical: "https://mowarsondeveloper.netlify.app/contact.html",
      priority: "0.85",
      changefreq: "monthly",
      schemas: ["ContactPage", "ContactPoint"]
    },
    "blog.html": {
      canonical: "https://mowarsondeveloper.netlify.app/blog.html",
      priority: "0.85",
      changefreq: "weekly",
      schemas: ["Blog", "CollectionPage"]
    },
    "privacy.html": {
      canonical: "https://mowarsondeveloper.netlify.app/privacy.html",
      priority: "0.3",
      changefreq: "yearly",
      schemas: ["WebPage"]
    },
    "terms.html": {
      canonical: "https://mowarsondeveloper.netlify.app/terms.html",
      priority: "0.3",
      changefreq: "yearly",
      schemas: ["WebPage"]
    },
    "refund.html": {
      canonical: "https://mowarsondeveloper.netlify.app/refund.html",
      priority: "0.3",
      changefreq: "yearly",
      schemas: ["WebPage"]
    },
    "pay.html": {
      canonical: "https://mowarsondeveloper.netlify.app/pay.html",
      priority: "0.3",
      changefreq: "monthly",
      schemas: ["WebPage"],
      noindex: true
    },
    "404.html": {
      noindex: true,
      excludeFromSitemap: true
    },
    "thank-you.html": {
      noindex: true,
      excludeFromSitemap: true
    }
  },

  // Blog articles metadata
  blogPosts: {
    "blog/lead-generation-strategies.html": {
      title: "Lead Generation Strategies That Work – Convert Traffic into Customers",
      description: "Proven lead generation strategies for small businesses: CTAs, landing pages, forms, and content upgrades that turn visitors into leads.",
      author: "Mowarson",
      datePublished: "2026-03-25",
      dateModified: "2026-11-22",
      image: "https://mowarsondeveloper.netlify.app/My-Image.jpg",
      canonical: "https://mowarsondeveloper.netlify.app/blog/lead-generation-strategies.html",
      articleSection: "Lead Generation & Conversion",
      keywords: ["lead generation", "conversion rate optimization", "landing pages", "call to action", "small business marketing"],
      breadcrumbName: "Lead Generation Strategies",
      priority: "0.7",
      changefreq: "monthly"
    },
    "blog/seo-friendly-website-design-tips.html": {
      title: "SEO Friendly Website Design – Actionable Tips & Best Practices",
      description: "Learn how to create an SEO friendly website with actionable tips on page speed, keyword placement, and technical SEO from an expert designer.",
      author: "Mowarson",
      datePublished: "2026-03-25",
      dateModified: "2026-11-22",
      image: "https://mowarsondeveloper.netlify.app/My-Image.jpg",
      canonical: "https://mowarsondeveloper.netlify.app/blog/seo-friendly-website-design-tips.html",
      articleSection: "SEO & Web Design",
      keywords: ["SEO website design", "technical SEO", "keyword research", "page speed optimization", "mobile responsiveness"],
      breadcrumbName: "SEO Friendly Website Design Tips",
      priority: "0.7",
      changefreq: "monthly"
    },
    "blog/web-design-consultant-tips.html": {
      title: "How to Choose a Web Design Consultant – Tips for Business Owners",
      description: "Learn what to look for when hiring a web design consultant, and how the right advice can save you time and money on your website project.",
      author: "Mowarson",
      datePublished: "2026-03-25",
      dateModified: "2026-11-22",
      image: "https://mowarsondeveloper.netlify.app/My-Image.jpg",
      canonical: "https://mowarsondeveloper.netlify.app/blog/web-design-consultant-tips.html",
      articleSection: "SEO & Web Consulting",
      keywords: ["web design consultant", "hiring a web designer", "SEO website consultant", "website strategy", "small business web design"],
      breadcrumbName: "How to Choose a Web Design Consultant",
      priority: "0.7",
      changefreq: "monthly"
    }
  }
};
