import LoadingScreen from '@/components/ui/LoadingScreen';
import Navbar from '@/components/sections/Navbar';
import Hero from '@/components/sections/Hero';
import ThreeInputsStrip from '@/components/sections/ThreeInputsStrip';
import LiveProductTheatre from '@/components/sections/LiveProductTheatre';
import HowItWorks from '@/components/sections/HowItWorks';
import WhatGetsMeasured from '@/components/sections/WhatGetsMeasured';
import ReportPreview from '@/components/sections/ReportPreview';
import AdaptiveInterviewer from '@/components/sections/AdaptiveInterviewer';
import CodingMode from '@/components/sections/CodingMode';
import WhoItsFor from '@/components/sections/WhoItsFor';
import HowScoringWorks from '@/components/sections/HowScoringWorks';
import PrivacySection from '@/components/sections/PrivacySection';
import PricingSection from '@/components/sections/PricingSection';
import EcosystemStrip from '@/components/sections/EcosystemStrip';
import FAQSection from '@/components/sections/FAQSection';
import FinalCTA from '@/components/sections/FinalCTA';
import Footer from '@/components/sections/Footer';

export default function Home() {
  return (
    <main className="min-h-screen bg-[#FFF8F0] text-[#1B1F3B] flex flex-col relative selection:bg-[#FF6B35] selection:text-white">
      {/* Initial Loading Screen */}
      <LoadingScreen />

      {/* 01. Sticky Navbar */}
      <Navbar />

      {/* Main Page Content */}
      <div className="flex-1 space-y-4 md:space-y-8">
        {/* 02. Hero */}
        <Hero />

        {/* 03. Three Inputs Strip */}
        <ThreeInputsStrip />

        {/* 04. Live Product Theatre */}
        <LiveProductTheatre />

        {/* 05. How It Works (5 Steps) */}
        <HowItWorks />

        {/* 06. What Gets Measured */}
        <WhatGetsMeasured />

        {/* 07. Report Preview (Highest Converter) */}
        <ReportPreview />

        {/* 08. The Adaptive Interviewer */}
        <AdaptiveInterviewer />

        {/* 09. Coding Mode */}
        <CodingMode />

        {/* 10. Who It's For */}
        <WhoItsFor />

        {/* 11. How Scoring Works */}
        <HowScoringWorks />

        {/* 12. Privacy & Recordings */}
        <PrivacySection />

        {/* 13. Pricing / Beta Access */}
        <PricingSection />

        {/* 14. Ecosystem Strip */}
        <EcosystemStrip />

        {/* 15. FAQ */}
        <FAQSection />

        {/* 16. Final CTA */}
        <FinalCTA />
      </div>

      {/* 17. Footer */}
      <Footer />
    </main>
  );
}
