# DocFlow — Content & Acceptable Use Policy

**Version 1.0 · Effective 26 September 2026**

This policy applies to the DocFlow software, this repository, and any
deployment of it (self-hosted, on your own server, or by a third party).

## 1. What DocFlow is

DocFlow is a general-purpose document toolkit: file conversion, compression,
image extraction, and a **peer-to-peer (BitTorrent/WebTorrent) transfer
feature** used to retrieve files from the open peer-to-peer network — the same
lawful technology used to distribute Linux distributions, open datasets,
Creative Commons media, scientific archives, and large public releases.

The software is a tool. It does not host, publish, supply, curate, index, or
recommend any content, and it does not link to any specific source of content.
As with a browser or a download manager, whatever a user asks it to fetch is
under that user's control and responsibility.

## 2. Lawful use is required

You may use DocFlow only for content that you:

- own; or
- have explicit permission or a licence to download and use; or
- is in the public domain or released under a permissive licence
  (e.g. Creative Commons, MIT, GPL, Apache); or
- may lawfully possess in your jurisdiction for another valid reason.

Examples of clearly legitimate uses: downloading a distributor's official ISO
image, an open-access dataset, a CC-licensed film (the repository's own test
fixture is *Big Buck Bunny*, CC-BY 3.0), a pay-what-you-want indie release, or
files you personally uploaded to a tracker you control.

## 3. Prohibited uses

You must **not** use DocFlow to:

- download or redistribute material you do not have the right to access,
  including copyrighted works shared without authorization;
- distribute malware, ransomware, spyware, or phishing material;
- share content that is illegal where you live (e.g. child sexual abuse
  material, terrorist content, stolen data);
- infringe anyone's privacy, publicity rights, or other personal rights;
- violate the acceptable-use policy of the network, server, or hosting
  provider you run it on, or evade any technical measure a provider has put in
  place.

## 4. Hosting providers and deployments

Deployments must respect the acceptable-use policy of their provider. Some
managed platforms restrict peer-to-peer traffic in their terms; DocFlow is
intended to be self-hosted on infrastructure where peer-to-peer transfer is
permitted (see [ORACLE_DEPLOYMENT.md](ORACLE_DEPLOYMENT.md) for the supported
path). Nothing in this repository is designed to conceal, spoof, or circumvent
a provider's review of what the software does — it is described plainly in the
README and in the source code.

## 5. Responsibility

- **End users** are solely responsible for the content they choose to
  retrieve, and for ensuring their use is lawful in their jurisdiction.
- **Deployers** are responsible for presenting this policy to their users and
  for handling abuse reports for their own instance.
- The project's contributors provide the software "as is", without warranty of
  any kind, and are not liable for content retrieved by third parties using
  deployments they do not operate.
- This repository is **not** released under an open-source licence: no rights
  are granted beyond evaluating and operating your own deployment
  (see README → *License*).

## 6. Reports, takedowns and abuse

To report content or a deployment of DocFlow being used unlawfully, email
**varunmandati7@gmail.com** with:

1. the deployment URL concerned,
2. the specific material and why it is unlawful where you are,
3. your contact details and a good-faith statement of accuracy.

We do not host the content itself, but reports about deployments of this
software will be forwarded to the operator of that deployment, and repositories
acting in good faith will be assisted in removing or disabling access to the
reported material.

## 7. Related documents

- [README.md](README.md) — product overview, architecture, deployment
- [ORACLE_DEPLOYMENT.md](ORACLE_DEPLOYMENT.md) — supported self-hosting path
- [KOYEB_DEPLOYMENT.md](KOYEB_DEPLOYMENT.md) — alternative managed hosting
