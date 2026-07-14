import { PrismaClient, type Language } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Realistic sample catalogue for local development and demos.
 *
 * Prices are per ISSUE, in PAISE, and are in the right ballpark for Indian newsstand
 * rates (₹4-₹8 a copy, Sunday editions dearer). Getting the order of magnitude right
 * matters: a demo that quotes ₹4,500 a month for a newspaper tells the viewer nothing
 * useful about whether the proration is correct.
 *
 * Idempotent — safe to run repeatedly. It upserts on natural keys rather than
 * truncating, so it will not wipe a database that has real subscriptions in it.
 */

interface EditionSeed {
  city: string;
  state: string;
  pricePerIssuePaise: number;
  servicePincodes: string[];
}

interface NewspaperSeed {
  name: string;
  language: Language;
  editions: EditionSeed[];
}

interface PublisherSeed {
  name: string;
  website: string;
  newspapers: NewspaperSeed[];
}

const BENGALURU = ['560001', '560002', '560008', '560025', '560034', '560038', '560095'];
const CHENNAI = ['600001', '600002', '600017', '600020', '600028', '600040'];
const DELHI = ['110001', '110016', '110024', '110048', '110065'];
const MUMBAI = ['400001', '400012', '400050', '400058', '400070'];
const HYDERABAD = ['500001', '500016', '500033', '500081'];
const KOLKATA = ['700001', '700019', '700029', '700064'];

const CATALOG: PublisherSeed[] = [
  {
    name: 'The Times Group',
    website: 'https://timesgroup.com',
    newspapers: [
      {
        name: 'The Times of India',
        language: 'ENGLISH',
        editions: [
          {
            city: 'Bengaluru',
            state: 'Karnataka',
            pricePerIssuePaise: 550,
            servicePincodes: BENGALURU,
          },
          {
            city: 'Mumbai',
            state: 'Maharashtra',
            pricePerIssuePaise: 600,
            servicePincodes: MUMBAI,
          },
          { city: 'Delhi', state: 'Delhi', pricePerIssuePaise: 600, servicePincodes: DELHI },
        ],
      },
      {
        name: 'The Economic Times',
        language: 'ENGLISH',
        editions: [
          {
            city: 'Mumbai',
            state: 'Maharashtra',
            pricePerIssuePaise: 800,
            servicePincodes: MUMBAI,
          },
          {
            city: 'Bengaluru',
            state: 'Karnataka',
            pricePerIssuePaise: 800,
            servicePincodes: BENGALURU,
          },
        ],
      },
      {
        name: 'Navbharat Times',
        language: 'HINDI',
        editions: [
          { city: 'Delhi', state: 'Delhi', pricePerIssuePaise: 400, servicePincodes: DELHI },
        ],
      },
    ],
  },
  {
    name: 'Kasturi & Sons',
    website: 'https://thehindu.com',
    newspapers: [
      {
        name: 'The Hindu',
        language: 'ENGLISH',
        editions: [
          {
            city: 'Chennai',
            state: 'Tamil Nadu',
            pricePerIssuePaise: 500,
            servicePincodes: CHENNAI,
          },
          // Same masthead, different city, DIFFERENT price — the whole reason an edition
          // rather than a newspaper is what a customer subscribes to.
          {
            city: 'Bengaluru',
            state: 'Karnataka',
            pricePerIssuePaise: 550,
            servicePincodes: BENGALURU,
          },
        ],
      },
    ],
  },
  {
    name: 'The Printers (Mysore)',
    website: 'https://deccanherald.com',
    newspapers: [
      {
        name: 'Deccan Herald',
        language: 'ENGLISH',
        editions: [
          {
            city: 'Bengaluru',
            state: 'Karnataka',
            pricePerIssuePaise: 450,
            servicePincodes: BENGALURU,
          },
        ],
      },
      {
        name: 'Prajavani',
        language: 'KANNADA',
        editions: [
          {
            city: 'Bengaluru',
            state: 'Karnataka',
            pricePerIssuePaise: 400,
            servicePincodes: BENGALURU,
          },
        ],
      },
    ],
  },
  {
    name: 'Daily Thanthi Group',
    website: 'https://dailythanthi.com',
    newspapers: [
      {
        name: 'Daily Thanthi',
        language: 'TAMIL',
        editions: [
          {
            city: 'Chennai',
            state: 'Tamil Nadu',
            pricePerIssuePaise: 350,
            servicePincodes: CHENNAI,
          },
        ],
      },
    ],
  },
  {
    name: 'Eenadu Group',
    website: 'https://eenadu.net',
    newspapers: [
      {
        name: 'Eenadu',
        language: 'TELUGU',
        editions: [
          {
            city: 'Hyderabad',
            state: 'Telangana',
            pricePerIssuePaise: 400,
            servicePincodes: HYDERABAD,
          },
        ],
      },
    ],
  },
  {
    name: 'ABP Group',
    website: 'https://anandabazar.com',
    newspapers: [
      {
        name: 'Anandabazar Patrika',
        language: 'BENGALI',
        editions: [
          {
            city: 'Kolkata',
            state: 'West Bengal',
            pricePerIssuePaise: 450,
            servicePincodes: KOLKATA,
          },
        ],
      },
      {
        name: 'The Telegraph',
        language: 'ENGLISH',
        editions: [
          {
            city: 'Kolkata',
            state: 'West Bengal',
            pricePerIssuePaise: 500,
            servicePincodes: KOLKATA,
          },
        ],
      },
    ],
  },
  {
    name: 'Lokmat Media',
    website: 'https://lokmat.com',
    newspapers: [
      {
        name: 'Lokmat',
        language: 'MARATHI',
        editions: [
          {
            city: 'Mumbai',
            state: 'Maharashtra',
            pricePerIssuePaise: 400,
            servicePincodes: MUMBAI,
          },
        ],
      },
    ],
  },
];

async function main(): Promise<void> {
  let publishers = 0;
  let newspapers = 0;
  let editions = 0;

  for (const publisherSeed of CATALOG) {
    const publisher = await prisma.publisher.upsert({
      where: { name: publisherSeed.name },
      update: { website: publisherSeed.website },
      create: { name: publisherSeed.name, website: publisherSeed.website },
    });
    publishers += 1;

    for (const newspaperSeed of publisherSeed.newspapers) {
      const newspaper = await prisma.newspaper.upsert({
        where: {
          publisherId_name_language: {
            publisherId: publisher.id,
            name: newspaperSeed.name,
            language: newspaperSeed.language,
          },
        },
        update: {},
        create: {
          publisherId: publisher.id,
          name: newspaperSeed.name,
          language: newspaperSeed.language,
        },
      });
      newspapers += 1;

      for (const editionSeed of newspaperSeed.editions) {
        await prisma.newspaperEdition.upsert({
          where: {
            newspaperId_city: { newspaperId: newspaper.id, city: editionSeed.city },
          },
          update: {
            pricePerIssuePaise: editionSeed.pricePerIssuePaise,
            servicePincodes: editionSeed.servicePincodes,
          },
          create: {
            newspaperId: newspaper.id,
            city: editionSeed.city,
            state: editionSeed.state,
            pricePerIssuePaise: editionSeed.pricePerIssuePaise,
            servicePincodes: editionSeed.servicePincodes,
          },
        });
        editions += 1;
      }
    }
  }

  const languages = new Set(CATALOG.flatMap((p) => p.newspapers.map((n) => n.language)));

  console.log(
    `Seeded ${publishers} publishers, ${newspapers} newspapers ` +
      `(${languages.size} languages), ${editions} city editions.`,
  );
  console.log('Try: GET /api/v1/catalog/editions?pincode=560038');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
