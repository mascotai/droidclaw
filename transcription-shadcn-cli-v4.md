# Shadcn CLI v4 - This Changes Everything (Exclusive First Look)

**Video:** https://www.youtube.com/watch?v=m-gIqQTHcAY
**Creator:** OrcDev (@orcdev)
**Date:** March 6, 2026 | **Views:** 54K | **Duration:** 16:00

---

## Transcription

This is an exclusive first look. Shadcn just dropped CLI version 4. Honestly, I thought this was going to be some small update, but this is massive. We have new commands, new goodies. We've all been asking for big changes to the Shadcn UI itself. Plus, Shadcn is officially going towards AI. Let me break down everything for you.

But first, let's hear from our sponsor. This video is sponsored by me. I have a project called Agent Packs where you can get preconfigured AI agents. There are 14 different packs available with 37 specialized agents. You have packs like content creator pack, dev team, solopreneur, fitness and training, health, finances, everything you need to automate your life. You simply download the agents from the portal that you can see here. Drop them inside of your OpenClaw instance and you can start talking to them. There is also a Discord community for all the pro members of Agent Packs. There we are sharing all the cool stuff, use cases. And if you don't know how to set up your OpenClaw, don't worry. I'm going to personally help you out to set it up on your machine and to start automating your life with Agent Packs. I created 10 discount coupons. So see you there on Discord.

### New `shadcn init` Command

And now let's see what goodies Shadcn prepared for us. Let's start from the beginning. First thing I'm going to show you is the new `shadcn init` command. You're going to notice that I'm using `@rc` in all of my commands here. By the time you're watching this video, you can just normally use `npx shadcn init`.

So let's start. First new thing that we have here are **new templates**. Before we had only Next.js, Vite, and Start. Now we have **React Router, Astro, and Laravel** which is really awesome especially if you love these frameworks. If you're using these frameworks, now you have three more options. I'm going to choose Vite here because that's the fastest option currently.

### Monorepo Support

And we have now our second new thing and that's "would you like to set up a monorepo?" Shadcn giving us this feature right here that we set up a monorepo directly when we are initializing and creating our new project is really powerful to get everything set up with all those frameworks. That is really crazy. I love this one.

### Component Library Selection

I'm not going to set up a monorepo now because I want to show you all the nice details. So next thing we have to select a component library. So we can select between **Radix and Base UI**. That one is old but we have it now in the CLI. We don't have to do it anymore from the create shadcn page. I'm going to choose Base UI.

### Presets — The Game Changer

And now we have that newest thing which is genius. And that one is called a **preset**. This is a new thing in Shadcn. So, what we can do here in the CLI, we can choose different presets. We can see for Nova that we have Lucid icons and Guys font. Then we have Vega which is Lucid icons plus Inter font. So, basically all the presets are different. Here we can see Phosphor icons and JetBrains Mono. I'm going to choose that one.

And now we just need to pick a name for our project. As always, it is going to be "i-love-shadcn." And now we are creating a new Vite project. This may take a few minutes — it's probably going to take like 15 seconds or something like that.

And there it is. Now we can just go to i-love-shadcn and run `pnpm dev`. And we have the project running on our localhost. And we can go and run it inside of our browser. We can see here that we have project ready — "You may now add components and start building." And we have all those preset things that we chose inside of CLI. So this here currently is Base UI with Phosphor icons. And we can see also that on `D` we can toggle to dark mode. So that is also a good thing. We have dark mode and everything working from scratch right here in our new project.

### Demo Component

And now we are going to add the demo component that Shadcn himself added for us. And that one is really easy. We are just calling `npx shadcn add demo` like this. And now we are going to add that whole demo component with all the components that we need together with that demo.

There it is. And we are going to open our code. So we need to put this one inside of our landing page. And now when we go back to our landing page, we can see here our entire design system. So this is the thing that we chose inside of our CLI and we can test it out. Here we can see the look of our buttons, all our colors, icons and all the things that we need basically to know how our project is going to look. And this is basically our mini design system that we are seeing right here.

### New Create Project Page

And are you ready for the newest thing in the Shadcn UI? Meet the **new Shadcn Create Project page**. Now this one is looking really crazy. So we can see here that everything is arranged differently. We don't have anymore that right sidebar. We have now everything inside of the left sidebar. We can choose all the things. And here we can go horizontally and vertically as well and check out all the things and how our style is going to look on different types of components. I love this new thing.

### Preset Strings — One Command Design System Swap

I think it is really good and the newest thing with the CLI that is connected to this new project page is the best thing in this update. Check this one out. So I'm choosing here for example Radix UI. So we chose Base UI in the CLI. We want to refactor the whole thing. Then for style we are choosing for example Vega. Then base color we are going to put Olive. And theme we can put some green. Font, we're going to put some Guys.  And for radius, we're going to put none.

And what can we do now? Now, this is the awesome part. We can just take our **preset** right here. It is this compressed string. And we can see the same thing as well in the URL. So basically all the search params that we had before are now moved to this preset. So everything is compressed into one preset string.

So I could now share this link with you and you would get entirely same design system style as me — like these green colors and without borders and all that stuff. So now we can actually click this preset thing right here and we can go to our terminal and type in `npx shadcn init` and then paste that preset. Now when I press enter — all the components are going to be overwritten. We are going to reinstall existing UI components.

So now all the components are going from Base UI to Radix and all those colors and everything — the entire design system is changing. We can go back here and we can see it live. Everything is being overwritten and we have entirely new design system.

**This is crazy. This is solving so many problems for different Shadcn libraries.** You can now initialize a block from some library like shadcn blocks and then you can just do this `init` with this new preset and you are changing entirely your entire design system with just one command. I love this. This was the missing piece in the Shadcn ecosystem.

### AI Skills Integration

Now next thing that we have new is where **Shadcn is going towards AI** and those are new **skills**. So we have now — you can just type in `npx skills add shadcn-ui/ui`. It is also able to initialize everything and presets are working. So I'm going to create here a new directory. And here I'm going to run my Claude Code.

Now we want to initialize a completely new application but with some presets that we want. So we are going to choose some preset from the create page. I'm going to copy that preset, go back to my Claude Code and say "initialize a new Shadcn app with this preset" and I'm just going to paste the preset. And there it is — we can see here now that we have framework Next.js, style Radix, mirror, Bix, Phosphor etc.

So let's try and run this application. We can see now here that we have completely new project and everything is ready and working with our same style.

It was already easy enough to work with Shadcn and AI. Now it's even more easy. One thing that Shadcn is supporting for skills is all the **trusted Shadcn registries**. So you can say something like "put some crazy background from React Bits on my landing page" and that one is going to work because in the skills we have all the trusted registries.

### New CLI Commands: Dry Run & Diff

Other things that we have new inside of the CLI which are really cool — for example we have now when we are adding a new block or a new component, we have this **dry run** which is really good because when we run it, we can see actually what we are going to override when we are adding that new block or component and what is remaining identical.

So button, card, input and label are okay but the separator is going to be overwritten by the new separator. These are all good things to know.

We also have a **diff** command. Instead of dry run we can run `diff` and we are going to see the exact differences that we are going to add. So for all these components there are no changes but for the separator we are adding `use client` which is really good information to have.

And also we can run — instead of `div` we are going to put `view` and we are actually going to see all the components that we are going to put inside of our project which is really important because **people could easily inject anything they want inside of our project** when we are using this from some different third-party library. So this is really important.

### Font Management

I want to show you also this thing right here. We have here our style and I'm just going to type in `npx shadcn add font merriweather`. So I'm changing the entire font and check out what is happening behind. I'm going to press enter and we're adding entirely new font, changing our design style and now it's refreshing and we have entirely new font. How awesome is this?

So we can do this with everything. We can refactor — like that preset thing. If we did that preset, it would also be instant. We are changing all the Shadcn components with just one command. This is really genius.

### Info Command

There is also a new `npx shadcn info` command. Now, this one is so powerful. It is giving us information about all the things — the entire tech stack on our project. And not only that — we can see everything about our tech stack. Then we have our configuration, our whole preset and what kind of components are we using. Then we have here the exact components that are installed on our projects.

### Summary

Now only this command, we could create an entire open-source project based on this command only. This update is so crazy. Shadcn is again making all the things easier for us and not only for us but also for AI.

Now we have that official skills file for Shadcn and all these commands — AI knows exactly all those commands. So it can check first like that `shadcn view` if all the files are secure then to put them inside of your project. It knows exactly how to use all those files, components, blocks, templates etc. and to put it inside of your project.

Then we have this whole preset thing which is satisfying both designers and developers. So we can see what kind of preset we are using. Then we have just this one string which we can give to our AI and everything is going to be refactored — not only the colors, fonts and things like that but also entire UI library. So we can refactor from Radix to Base UI in one command. That is really crazy.

And all these icon libraries, fonts — all things just with one command. We are doing everything. And that's it. I love this update and I think that this is really a massive one. I really hope you enjoyed this video. Tell me in the comments what do you think about this new update. And for more content like this, join the mighty horde.
