export interface Brand {
  name: string;
  tagline: string;
  footer: string;
  primaryColour: string;
  titleSuffix: string;
}

const platform21: Brand = {
  name: "Platform21",
  tagline: "Secure Client Intake",
  footer: "Platform21 &middot; South East Queensland",
  primaryColour: "#1e3a5f",
  titleSuffix: "Platform21",
};

const ecomow: Brand = {
  name: "EcoMow",
  tagline: "Secure Client Intake",
  footer: "EcoMow Sustainable Gardening &middot; South East Queensland",
  primaryColour: "#ef382a",
  titleSuffix: "EcoMow",
};

export function getBrand(hostname: string | undefined): Brand {
  if (hostname?.includes("ecomow")) {
    return ecomow;
  }
  return platform21;
}
