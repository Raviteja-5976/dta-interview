'use client';

import { Terminal, Play, CheckCircle2, Mic, Code2 } from 'lucide-react';

export default function CodingMode() {
  return (
    <section className="py-16 md:py-24 px-4 md:px-8 max-w-[1320px] mx-auto">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-12">
        <span className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-widest text-[#FF6B35] uppercase bg-[#F5EBE0] px-3.5 py-1.5 border-2 border-[#1B1F3B] rounded-full inline-block mb-3">
          SEAMLESS IDE SWITCH
        </span>
        <h2 className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl font-black text-[#1B1F3B] tracking-tight mb-4">
          When it's time to code, the screen changes.
        </h2>
        <p className="font-[family-name:var(--font-body)] text-base md:text-lg text-[#1B1F3B]/80">
          Integrated coding environment where the AI listens as you talk through your implementation.
        </p>
      </div>

      {/* Main Split Panel Editor Mockup */}
      <div className="bg-[#1B1F3B] text-[#FFF8F0] border-4 border-[#1B1F3B] rounded-3xl shadow-[14px_14px_0_#1B1F3B] overflow-hidden max-w-5xl mx-auto">
        {/* Editor Window Chrome Bar */}
        <div className="bg-[#24294A] px-4 py-3 border-b-2 border-white/20 flex items-center justify-between font-[family-name:var(--font-mono)] text-xs">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-[#FF5C7A]" />
            <span className="w-3 h-3 rounded-full bg-[#FFC93C]" />
            <span className="w-3 h-3 rounded-full bg-[#6EE7B7]" />
            <span className="ml-3 text-white font-bold flex items-center gap-1.5">
              <Code2 className="w-4 h-4 text-[#6EE7B7]" /> lru_cache_impl.py
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 bg-[#6EE7B7] text-[#1B1F3B] font-bold rounded text-[10px]">
              TESTS PASSED 4/4
            </span>
            <span className="px-2.5 py-0.5 bg-[#FFC93C] text-[#1B1F3B] font-bold rounded text-[10px]">
              OPTIONAL MODULE
            </span>
          </div>
        </div>

        {/* Editor Body Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* Left: Code Editor Window */}
          <div className="lg:col-span-8 p-6 font-[family-name:var(--font-mono)] text-xs md:text-sm bg-[#1B1F3B] border-b lg:border-b-0 lg:border-r border-white/10 space-y-2">
            <div className="text-white/40">// Implementing O(1) LRU Cache with doubly linked list</div>
            <div>
              <span className="text-[#FF6B35]">class</span> <span className="text-[#FFC93C]">LRUCache</span>:
            </div>
            <div className="pl-4">
              <span className="text-[#FF6B35]">def</span> <span className="text-[#4EA8FF]">__init__</span>(self, capacity: <span className="text-[#FF5C7A]">int</span>):
            </div>
            <div className="pl-8 text-white">
              self.capacity = capacity
            </div>
            <div className="pl-8 text-white">
              self.cache = &#123;&#125; <span className="text-white/40"># key to node mapping</span>
            </div>
            <div className="pl-4 pt-2">
              <span className="text-[#FF6B35]">def</span> <span className="text-[#4EA8FF]">get</span>(self, key: <span className="text-[#FF5C7A]">int</span>) -&gt; <span className="text-[#FF5C7A]">int</span>:
            </div>
            <div className="pl-8 text-white">
              <span className="text-[#FF6B35]">if</span> key <span className="text-[#FF6B35]">in</span> self.cache:
            </div>
            <div className="pl-12 text-[#6EE7B7]">
              self._moveToHead(self.cache[key])
            </div>
            <div className="pl-12 text-[#6EE7B7]">
              <span className="text-[#FF6B35]">return</span> self.cache[key].val
            </div>

            {/* Test Execution Output Box */}
            <div className="mt-6 p-4 bg-[#24294A] border border-[#6EE7B7]/40 rounded-xl text-xs text-[#6EE7B7]">
              <div className="flex items-center gap-2 font-bold mb-1">
                <Terminal className="w-4 h-4" /> TEST SUITE EXECUTED:
              </div>
              <div>✓ Test 01: Get existing key O(1) -&gt; Passed</div>
              <div>✓ Test 02: Evict least recently used when over capacity -&gt; Passed</div>
            </div>
          </div>

          {/* Right: Live Voice Audio Side Panel */}
          <div className="lg:col-span-4 p-6 bg-[#24294A] flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-[family-name:var(--font-mono)] text-[#6EE7B7] font-bold">
                <Mic className="w-4 h-4 animate-pulse text-[#FF6B35]" /> VOICE REASONING ACTIVE
              </div>
              
              <div className="p-3 bg-[#1B1F3B] border border-white/10 rounded-xl text-xs text-[#F5EBE0]">
                <span className="font-mono text-[#FFC93C] block mb-1">Interviewer Prompt:</span>
                "Explain why you chose a Hash Map + Doubly Linked List over Python's OrderedDict."
              </div>

              <div className="p-3 bg-[#FF6B35]/20 border border-[#FF6B35] rounded-xl text-xs text-[#FFF8F0]">
                <span className="font-mono text-[#6EE7B7] block mb-1">Your Voice Explanation:</span>
                "Because a doubly linked list provides guaranteed O(1) node deletion and insertion when we hold node references..."
              </div>
            </div>

            {/* Feature Bullets */}
            <div className="space-y-2 border-t border-white/10 pt-4 text-xs font-[family-name:var(--font-body)]">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#6EE7B7]" />
                <span>You think out loud while you type</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#6EE7B7]" />
                <span>Tests run against your solution in real-time</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#6EE7B7]" />
                <span>Scored on code & communication</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center mt-6">
        <span className="inline-block px-3 py-1 bg-[#F5EBE0] border-2 border-[#1B1F3B] rounded-full font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B]">
          💡 Optional — toggle coding round off in setup if you only want system design or behavior.
        </span>
      </div>
    </section>
  );
}
